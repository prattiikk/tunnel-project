import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client'
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const prisma = new PrismaClient();

// In-memory store for active agents: tunnelId → WebSocket
const agents = new Map();
const pendingResponses = new Map(); // requestId → Express `res`

// Analytics buffer and tracking
const metricsBuffer = [];
const uniqueIpsBuffer = new Map(); // tunnelId → Set of IPs
const activeRequests = new Map(); // requestId → { startTime, tunnelId, req }

// Console logging helpers
function logWithTimestamp(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = {
        'INFO': '📊',
        'SUCCESS': '✅',
        'ERROR': '❌',
        'WARN': '⚠️',
        'DEBUG': '🔍'
    }[level] || 'ℹ️';

    console.log(`${prefix} [${timestamp}] ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// User management functions
async function ensureUserExists(userData) {
    try {
        const { userId, email, name } = userData;

        // First try to find existing user
        let user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            // Try to find by email if provided
            if (email) {
                user = await prisma.user.findUnique({
                    where: { email }
                });
            }

            // Create new user if not found
            if (!user) {
                user = await prisma.user.create({
                    data: {
                        id: userId,
                        email: email || `user_${userId}@unknown.com`,
                        name: name || `User ${userId.substring(0, 8)}`
                    }
                });

                logWithTimestamp('SUCCESS', `👤 Created new user`, {
                    userId: user.id,
                    email: user.email,
                    name: user.name
                });
            } else if (user.id !== userId) {
                // Update user ID if found by email but different ID
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { id: userId }
                });
            }
        }

        return user;
    } catch (error) {
        logWithTimestamp('ERROR', `Failed to ensure user exists`, {
            userData,
            error: error.message
        });
        throw error;
    }
}

// Generate unique subdomain
async function generateUniqueSubdomain(baseName, userId) {
    const baseSubdomain = baseName ?
        baseName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20) :
        `tunnel-${userId.substring(0, 8)}`;

    let subdomain = baseSubdomain;
    let counter = 1;

    while (true) {
        const existing = await prisma.tunnel.findUnique({
            where: { subdomain }
        });

        if (!existing) {
            return subdomain;
        }

        subdomain = `${baseSubdomain}-${counter}`;
        counter++;

        // Prevent infinite loops
        if (counter > 100) {
            return `${baseSubdomain}-${Date.now()}`;
        }
    }
}

// Analytics middleware
async function storeReqData(req, res, tunnelId) {
    const startTime = Date.now();
    const requestId = uuidv4();

    // Store request info for later completion
    activeRequests.set(requestId, {
        startTime,
        tunnelId,
        req,
        path: req.path,
        method: req.method,
        clientIp: getClientIP(req),
        requestSize: parseInt(req.get('content-length') || '0')
    });

    logWithTimestamp('DEBUG', `📥 Incoming request`, {
        requestId: requestId.substring(0, 8),
        tunnelId: tunnelId,
        method: req.method,
        path: req.path,
        clientIp: getClientIP(req),
        userAgent: req.get('user-agent')?.substring(0, 50) + '...',
        requestSize: formatBytes(parseInt(req.get('content-length') || '0'))
    });

    // Hook into response finish
    const originalSend = res.send;
    const originalStatus = res.status;
    let statusCode = 200;
    let responseSize = 0;

    res.status = function (code) {
        statusCode = code;
        return originalStatus.call(this, code);
    };

    res.send = function (data) {
        const responseTime = Date.now() - startTime;
        responseSize = Buffer.byteLength(data || '', 'utf8');

        logWithTimestamp('DEBUG', `📤 Outgoing response`, {
            requestId: requestId.substring(0, 8),
            statusCode,
            responseTime: `${responseTime}ms`,
            responseSize: formatBytes(responseSize)
        });

        // Capture metrics
        storeRespData(requestId, statusCode, responseTime, responseSize);

        return originalSend.call(this, data);
    };

    return requestId;
}

async function storeRespData(requestId, statusCode, responseTime, responseSize) {
    const requestData = activeRequests.get(requestId);
    if (!requestData) return;

    const { tunnelId, req, clientIp, requestSize } = requestData;

    // Get country from IP
    const country = await getCountryFromIP(clientIp);

    const metric = {
        tunnelId: tunnelId,
        path: req.path,
        method: req.method,
        country,
        statusCode,
        responseTime,
        requestSize,
        responseSize,
        clientIp,
        userAgent: req.get('user-agent'),
        timestamp: new Date()
    };

    // Add to buffer
    metricsBuffer.push(metric);

    logWithTimestamp('INFO', `📊 Metric captured for tunnel ${tunnelId}`, {
        path: `${req.method} ${req.path}`,
        statusCode,
        responseTime: `${responseTime}ms`,
        country,
        bufferSize: metricsBuffer.length
    });

    // Track unique IPs per tunnel
    if (!uniqueIpsBuffer.has(tunnelId)) {
        uniqueIpsBuffer.set(tunnelId, new Set());
    }
    const wasNewIp = !uniqueIpsBuffer.get(tunnelId).has(clientIp);
    uniqueIpsBuffer.get(tunnelId).add(clientIp);

    if (wasNewIp) {
        logWithTimestamp('INFO', `🌍 New unique visitor for tunnel ${tunnelId}`, {
            country,
            totalUniqueIps: uniqueIpsBuffer.get(tunnelId).size
        });
    }

    // Update live stats immediately
    await updateLiveStats(tunnelId, metric);

    // Store individual request log
    await storeRequestLog(metric);

    // Process buffer if it's getting large
    if (metricsBuffer.length >= 100) {
        logWithTimestamp('WARN', `Buffer size reached 100, processing metrics...`);
        processMetricsBuffer();
    }

    // Clean up
    activeRequests.delete(requestId);
}

// Store individual request log
async function storeRequestLog(metric) {
    try {
        await prisma.requestLog.create({
            data: {
                tunnelId: metric.tunnelId,
                path: metric.path,
                method: metric.method,
                statusCode: metric.statusCode,
                responseTime: metric.responseTime,
                requestSize: metric.requestSize,
                responseSize: metric.responseSize,
                clientIp: metric.clientIp,
                country: metric.country,
                userAgent: metric.userAgent?.substring(0, 500), // Truncate long user agents
                timestamp: metric.timestamp
            }
        });

        logWithTimestamp('DEBUG', `📝 Request log stored for tunnel ${metric.tunnelId}`);
    } catch (error) {
        logWithTimestamp('ERROR', `Failed to store request log for tunnel ${metric.tunnelId}`, {
            error: error.message
        });
    }
}

// Get client IP from various headers
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.headers['cf-connecting-ip'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
        'unknown';
}

// Update live stats for real-time dashboard
async function updateLiveStats(tunnelId, metric) {
    try {
        const liveStats = await prisma.liveStats.upsert({
            where: { tunnelId },
            create: {
                tunnelId,
                requestsLast5Min: 1,
                requestsLast1Hour: 1,
                avgResponseTime: metric.responseTime,
                errorRate: metric.statusCode >= 400 ? 1 : 0,
                lastUpdated: new Date()
            },
            update: {
                requestsLast5Min: { increment: 1 },
                requestsLast1Hour: { increment: 1 },
                avgResponseTime: metric.responseTime,
                errorRate: metric.statusCode >= 400 ? { increment: 1 } : undefined,
                lastUpdated: new Date()
            }
        });

        logWithTimestamp('SUCCESS', `💾 Live stats updated for tunnel ${tunnelId}`, {
            requests5Min: liveStats.requestsLast5Min,
            requests1Hour: liveStats.requestsLast1Hour,
            avgResponseTime: `${liveStats.avgResponseTime}ms`,
            errorRate: liveStats.errorRate,
            isError: metric.statusCode >= 400
        });

    } catch (error) {
        logWithTimestamp('ERROR', `Failed to update live stats for tunnel ${tunnelId}`, {
            error: error.message,
            tunnelId,
            metric
        });
    }
}

// Process buffered metrics
async function processMetricsBuffer() {
    if (metricsBuffer.length === 0) return;

    logWithTimestamp('INFO', `🔄 Processing metrics buffer`, {
        totalMetrics: metricsBuffer.length,
        uniqueTunnels: new Set(metricsBuffer.map(m => m.tunnelId)).size
    });

    // Group metrics by tunnel and hour
    const hourlyGroups = new Map();

    for (const metric of metricsBuffer) {
        const hourKey = `${metric.tunnelId}-${getHourKey(metric.timestamp)}`;
        if (!hourlyGroups.has(hourKey)) {
            hourlyGroups.set(hourKey, []);
        }
        hourlyGroups.get(hourKey).push(metric);
    }

    logWithTimestamp('INFO', `📊 Grouped into ${hourlyGroups.size} hourly buckets`);

    // Process each hourly group
    for (const [hourKey, metrics] of hourlyGroups) {
        await updateHourlyStats(hourKey, metrics);
    }

    // Show summary of what was processed
    const tunnelSummary = {};
    metricsBuffer.forEach(metric => {
        if (!tunnelSummary[metric.tunnelId]) {
            tunnelSummary[metric.tunnelId] = { requests: 0, errors: 0, countries: new Set() };
        }
        tunnelSummary[metric.tunnelId].requests++;
        if (metric.statusCode >= 400) tunnelSummary[metric.tunnelId].errors++;
        tunnelSummary[metric.tunnelId].countries.add(metric.country);
    });

    logWithTimestamp('SUCCESS', `✅ Processed ${metricsBuffer.length} metrics`, {
        tunnelSummary: Object.fromEntries(
            Object.entries(tunnelSummary).map(([tunnelId, stats]) => [
                tunnelId,
                {
                    requests: stats.requests,
                    errors: stats.errors,
                    errorRate: `${((stats.errors / stats.requests) * 100).toFixed(1)}%`,
                    countries: stats.countries.size
                }
            ])
        )
    });

    // Clear processed metrics
    metricsBuffer.length = 0;
    uniqueIpsBuffer.clear();
}

// Update hourly aggregated stats
async function updateHourlyStats(hourKey, metrics) {
    const [tunnelId, hourString] = hourKey.split('-', 2);
    const hour = new Date(hourString);

    // Calculate aggregated metrics
    const totalRequests = metrics.length;
    const successRequests = metrics.filter(m => m.statusCode < 400).length;
    const errorRequests = totalRequests - successRequests;
    const avgResponseTime = metrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests;
    const totalBandwidth = metrics.reduce((sum, m) => sum + m.requestSize + m.responseSize, 0);

    // Get unique IPs for this tunnel and hour
    const uniqueIps = new Set(metrics.map(m => m.clientIp)).size;

    // Aggregate top paths
    const pathCounts = new Map();
    metrics.forEach(m => {
        const key = `${m.method} ${m.path}`;
        pathCounts.set(key, (pathCounts.get(key) || 0) + 1);
    });
    const topPaths = Object.fromEntries(
        Array.from(pathCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
    );

    // Aggregate top countries
    const countryCounts = new Map();
    metrics.forEach(m => {
        if (m.country) {
            countryCounts.set(m.country, (countryCounts.get(m.country) || 0) + 1);
        }
    });
    const topCountries = Object.fromEntries(
        Array.from(countryCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
    );

    // Aggregate status codes
    const statusCounts = new Map();
    metrics.forEach(m => {
        const code = m.statusCode.toString();
        statusCounts.set(code, (statusCounts.get(code) || 0) + 1);
    });
    const statusCodes = Object.fromEntries(statusCounts);

    logWithTimestamp('INFO', `📈 Updating hourly stats for tunnel ${tunnelId}`, {
        hour: hour.toISOString(),
        totalRequests,
        successRequests,
        errorRequests,
        errorRate: `${((errorRequests / totalRequests) * 100).toFixed(1)}%`,
        avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
        totalBandwidth: formatBytes(totalBandwidth),
        uniqueIps,
        topPaths: Object.keys(topPaths).slice(0, 3),
        topCountries: Object.keys(topCountries).slice(0, 3)
    });

    try {
        const result = await prisma.hourlyStats.upsert({
            where: {
                tunnelId_hour: { tunnelId, hour }
            },
            create: {
                tunnelId,
                hour,
                totalRequests,
                successRequests,
                errorRequests,
                avgResponseTime,
                totalBandwidth: BigInt(totalBandwidth),
                uniqueIps,
                topPaths,
                topCountries,
                statusCodes,
            },
            update: {
                totalRequests: { increment: totalRequests },
                successRequests: { increment: successRequests },
                errorRequests: { increment: errorRequests },
                avgResponseTime: avgResponseTime,
                totalBandwidth: { increment: BigInt(totalBandwidth) },
                uniqueIps: { increment: uniqueIps },
                topPaths,
                topCountries,
                statusCodes,
            }
        });

        logWithTimestamp('SUCCESS', `💾 Hourly stats saved to database`, {
            tunnelId,
            hour: hour.toISOString(),
            recordId: result.id || 'updated'
        });

    } catch (error) {
        logWithTimestamp('ERROR', `Failed to update hourly stats`, {
            tunnelId,
            hour: hour.toISOString(),
            error: error.message,
            stack: error.stack
        });
    }
}

// Helper function to create hour key
function getHourKey(date) {
    const hour = new Date(date);
    hour.setMinutes(0, 0, 0, 0);
    return hour.toISOString();
}

// Get country from IP using free service
async function getCountryFromIP(ip) {
    if (ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return 'LOCAL';
    }

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
        const data = await response.json();
        const country = data.countryCode || 'UNKNOWN';

        if (country !== 'UNKNOWN') {
            logWithTimestamp('DEBUG', `🌍 IP geolocation resolved`, {
                ip: ip.replace(/\d+$/, 'xxx'), // Partially mask IP for privacy
                country
            });
        }

        return country;
    } catch (error) {
        logWithTimestamp('WARN', `Failed to get country for IP`, {
            ip: ip.replace(/\d+$/, 'xxx'),
            error: error.message
        });
        return 'UNKNOWN';
    }
}

// Function to get tunnel by subdomain/agentId
async function getTunnelByIdentifier(identifier) {
    try {
        // First try to find by subdomain
        let tunnel = await prisma.tunnel.findUnique({
            where: { subdomain: identifier },
            include: { user: true }
        });

        // If not found by subdomain, try by tunnel ID
        if (!tunnel) {
            tunnel = await prisma.tunnel.findUnique({
                where: { id: identifier },
                include: { user: true }
            });
        }

        return tunnel;
    } catch (error) {
        logWithTimestamp('ERROR', `Failed to get tunnel by identifier: ${identifier}`, {
            error: error.message
        });
        return null;
    }
}

// Improved WebSocket connection handling
wss.on('connection', (ws) => {
    let wsTunnelId = null;
    let tunnelRecord = null;

    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            logWithTimestamp('WARN', '⚠️ Invalid JSON received from WebSocket');
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid JSON format'
            }));
            return;
        }

        if (msg.type === 'register') {
            const { agentId, token, tunnelName, subdomain, localPort, description } = msg;

            try {
                const JWT_SECRET = process.env.JWT_SECRET?.trim();
                if (!JWT_SECRET) {
                    throw new Error('JWT_SECRET not configured');
                }

                const userData = jwt.verify(token, JWT_SECRET);
                ws.user = userData;
                wsTunnelId = agentId;

                logWithTimestamp('INFO', `🔐 User authenticated`, {
                    userId: userData.userId,
                    email: userData.email,
                    tunnelId: wsTunnelId
                });

                // Ensure user exists in database
                await ensureUserExists(userData);

                // Check for existing connection and close it
                if (agents.has(wsTunnelId)) {
                    const oldWs = agents.get(wsTunnelId);
                    oldWs.close(4002, 'Duplicate tunnel ID. Disconnected.');
                    logWithTimestamp('WARN', `Kicked old agent with duplicate tunnel ID: ${wsTunnelId}`);
                    agents.delete(wsTunnelId);
                }

                // Handle tunnel creation/update
                // Replace the tunnel creation/update logic around line 220-280

                // Handle tunnel creation/update
                try {
                    // Look for existing tunnel by ID first, then by subdomain
                    let existingTunnel = await prisma.tunnel.findUnique({
                        where: { id: wsTunnelId }
                    });

                    // FIXED: Use agentId as subdomain if no explicit subdomain provided
                    const desiredSubdomain = subdomain || wsTunnelId;

                    // Check if the desired subdomain is already taken by another tunnel
                    const subdomainConflict = await prisma.tunnel.findFirst({
                        where: {
                            subdomain: desiredSubdomain,
                            id: { not: wsTunnelId } // Exclude current tunnel
                        }
                    });

                    if (subdomainConflict) {
                        // If there's a conflict and no explicit subdomain was provided, generate unique one
                        const finalSubdomain = subdomain ?
                            subdomain :
                            await generateUniqueSubdomain(tunnelName || `tunnel-${wsTunnelId.substring(0, 8)}`, userData.userId);

                        logWithTimestamp('WARN', `Subdomain conflict detected`, {
                            desired: desiredSubdomain,
                            conflictWith: subdomainConflict.id,
                            using: finalSubdomain
                        });

                        desiredSubdomain = finalSubdomain;
                    }

                    if (existingTunnel) {
                        // Update existing tunnel
                        tunnelRecord = await prisma.tunnel.update({
                            where: { id: existingTunnel.id },
                            data: {
                                name: tunnelName || existingTunnel.name,
                                subdomain: desiredSubdomain,
                                localPort: localPort || existingTunnel.localPort,
                                description: description || existingTunnel.description,
                                isActive: true,
                                lastConnected: new Date(),
                                connectedAt: new Date(),
                            },
                            include: { user: true }
                        });

                        logWithTimestamp('SUCCESS', `📝 Updated existing tunnel`, {
                            tunnelId: tunnelRecord.id,
                            name: tunnelRecord.name,
                            subdomain: tunnelRecord.subdomain,
                            previousSubdomain: existingTunnel.subdomain,
                            previouslyActive: existingTunnel.isActive
                        });
                    } else {
                        // Create new tunnel
                        tunnelRecord = await prisma.tunnel.create({
                            data: {
                                id: wsTunnelId,
                                userId: userData.userId,
                                name: tunnelName || `Tunnel-${wsTunnelId.substring(0, 8)}`,
                                subdomain: desiredSubdomain,
                                localPort: localPort || 3000,
                                description: description || 'Auto-created tunnel',
                                isActive: true,
                                lastConnected: new Date(),
                                connectedAt: new Date(),
                            },
                            include: { user: true }
                        });

                        logWithTimestamp('SUCCESS', `🆕 Created new tunnel`, {
                            tunnelId: tunnelRecord.id,
                            name: tunnelRecord.name,
                            subdomain: tunnelRecord.subdomain,
                            userId: userData.userId,
                            usingTunnelIdAsSubdomain: desiredSubdomain === wsTunnelId
                        });
                    }

                    // Rest of the registration logic remains the same...
                    // Store WebSocket connection
                    agents.set(wsTunnelId, ws);

                    // Send success response
                    const publicUrl = `${process.env.BASE_URL || 'http://localhost:8080'}/${tunnelRecord.subdomain}`;

                    ws.send(JSON.stringify({
                        type: 'registered',
                        success: true,
                        tunnel: {
                            id: tunnelRecord.id,
                            name: tunnelRecord.name,
                            subdomain: tunnelRecord.subdomain,
                            url: publicUrl,
                            isActive: tunnelRecord.isActive,
                            localPort: tunnelRecord.localPort,
                            description: tunnelRecord.description,
                            createdAt: tunnelRecord.createdAt,
                            connectedAt: tunnelRecord.connectedAt
                        },
                        message: existingTunnel ? 'Tunnel updated and connected' : 'Tunnel created successfully'
                    }));

                    logWithTimestamp('SUCCESS', `🔗 Tunnel registered successfully`, {
                        tunnelId: wsTunnelId,
                        subdomain: tunnelRecord.subdomain,
                        publicUrl,
                        user: userData.email,
                        totalActiveAgents: agents.size,
                        isNewTunnel: !existingTunnel
                    });

                } catch (dbError) {
                    // Error handling remains the same...
                    logWithTimestamp('ERROR', `Database error during tunnel registration`, {
                        tunnelId: wsTunnelId,
                        userId: userData.userId,
                        error: dbError.message,
                        code: dbError.code
                    });

                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to register tunnel in database',
                        error: dbError.message
                    }));

                    ws.close(4003, 'Database registration failed');
                    return;
                }
            } catch (authError) {
                logWithTimestamp('ERROR', `Authentication failed`, {
                    error: authError.message,
                    tunnelId: wsTunnelId
                });

                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Authentication failed',
                    error: authError.message
                }));

                ws.close(4001, 'Authentication failed');
                return;
            }
        }

        // Handle response messages
        // In your WebSocket message handler, around line 315-325
        // Replace this section:

        else if (msg.type === 'response') {
            const { id, statusCode, headers, body } = msg;
            const res = pendingResponses.get(id);

            if (res) {
                try {
                    res.set(headers || {});
                    // FIX: Ensure body is properly serialized
                    let responseBody = body;
                    if (typeof body === 'object' && body !== null) {
                        responseBody = JSON.stringify(body);
                        // Set content-type if not already set
                        if (!res.get('content-type')) {
                            res.set('content-type', 'application/json');
                        }
                    }
                    res.status(statusCode || 200).send(responseBody || '');
                    pendingResponses.delete(id);

                    logWithTimestamp('DEBUG', `📤 Response forwarded`, {
                        requestId: id.substring(0, 8),
                        tunnelId: wsTunnelId,
                        statusCode: statusCode || 200,
                        bodyType: typeof body,
                        isArray: Array.isArray(body)
                    });
                } catch (error) {
                    logWithTimestamp('ERROR', `Failed to send response`, {
                        requestId: id.substring(0, 8),
                        tunnelId: wsTunnelId,
                        error: error.message,
                        bodyType: typeof body,
                        isArray: Array.isArray(body)
                    });
                }
            } else {
                logWithTimestamp('WARN', `No pending response found for request ID: ${id.substring(0, 8)}`);
            }
        }

        // Handle ping messages for keepalive
        else if (msg.type === 'ping') {
            ws.send(JSON.stringify({
                type: 'pong',
                timestamp: Date.now()
            }));
        }

        // Handle unknown message types
        else {
            logWithTimestamp('WARN', `Unknown message type received: ${msg.type}`, {
                tunnelId: wsTunnelId
            });
        }
    });

    ws.on('close', async (code, reason) => {
        if (wsTunnelId && tunnelRecord) {
            try {
                await prisma.tunnel.update({
                    where: { id: tunnelRecord.id },
                    data: {
                        isActive: false,
                        lastDisconnected: new Date()
                    }
                });

                logWithTimestamp('INFO', `🔌 Tunnel disconnected and marked inactive`, {
                    tunnelId: tunnelRecord.id,
                    subdomain: tunnelRecord.subdomain,
                    code,
                    reason: reason?.toString(),
                    remainingAgents: agents.size - 1
                });
            } catch (error) {
                logWithTimestamp('ERROR', `Failed to update tunnel on disconnect`, {
                    tunnelId: tunnelRecord.id,
                    error: error.message
                });
            }

            agents.delete(wsTunnelId);
        }
    });

    ws.on('error', (err) => {
        logWithTimestamp('ERROR', `WebSocket error`, {
            tunnelId: wsTunnelId || 'unknown',
            error: err.message
        });
    });

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to tunnel server',
        timestamp: Date.now()
    }));
});

// HTTP tunnel endpoint with analytics
app.use(async (req, res) => {
    const pathParts = req.path.split('/').filter(part => part !== '');

    if (pathParts.length === 0) {
        return res.status(400).json({
            error: 'Invalid tunnel path',
            message: 'Please specify a tunnel subdomain: /{subdomain}/path'
        });
    }

    const [identifier, ...rest] = pathParts;
    const targetPath = '/' + rest.join('/');

    // Get tunnel from database
    const tunnel = await getTunnelByIdentifier(identifier);

    if (!tunnel) {
        logWithTimestamp('WARN', `No tunnel found for identifier: "${identifier}"`);
        return res.status(404).json({
            error: 'Tunnel not found',
            message: `No tunnel found for identifier: "${identifier}"`,
            identifier
        });
    }

    if (!tunnel.isActive) {
        logWithTimestamp('WARN', `Tunnel is inactive: "${identifier}"`);
        return res.status(503).json({
            error: 'Tunnel inactive',
            message: `Tunnel "${identifier}" is not currently active`,
            tunnel: {
                id: tunnel.id,
                name: tunnel.name,
                subdomain: tunnel.subdomain,
                lastConnected: tunnel.lastConnected,
                lastDisconnected: tunnel.lastDisconnected
            }
        });
    }

    // Check if agent is connected
    const agent = agents.get(tunnel.id);

    if (!agent) {
        logWithTimestamp('WARN', `No active agent for tunnel: "${identifier}" (ID: ${tunnel.id})`);
        return res.status(502).json({
            error: 'Tunnel not connected',
            message: `Tunnel "${identifier}" is not currently connected`,
            tunnel: {
                id: tunnel.id,
                name: tunnel.name,
                subdomain: tunnel.subdomain,
                isActive: tunnel.isActive,
                lastConnected: tunnel.lastConnected
            }
        });
    }













    // Start analytics tracking using tunnel.id
    const analyticsId = await storeReqData(req, res, tunnel.id);
    const requestId = uuidv4();
    let body = '';

    req.on('data', chunk => body += chunk);

    req.on('end', () => {
        pendingResponses.set(requestId, res);

        try {
            agent.send(JSON.stringify({
                type: 'request',
                id: requestId,
                method: req.method,
                path: targetPath,
                headers: req.headers,
                body,
            }));

            // Timeout handling
            const timeoutId = setTimeout(() => {
                if (pendingResponses.has(requestId)) {
                    // Capture timeout as error
                    storeRespData(analyticsId, 504, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);

                    logWithTimestamp('WARN', `⏱️ Request timeout for tunnel ${tunnel.id}`, {
                        requestId: requestId.substring(0, 8),
                        path: targetPath,
                        method: req.method,
                        tunnelName: tunnel.name
                    });

                    res.status(504).send('Request timed out');
                    pendingResponses.delete(requestId);
                }
            }, 10000);

            // Clear timeout if response comes back
            const originalSend = res.send;
            res.send = function (data) {
                clearTimeout(timeoutId);
                return originalSend.call(this, data);
            };

        } catch (err) {
            pendingResponses.delete(requestId);

            // Capture error metrics
            storeRespData(analyticsId, 500, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);

            logWithTimestamp('ERROR', `Failed to send request to tunnel ${tunnel.id}`, {
                error: err.message,
                requestId: requestId.substring(0, 8),
                tunnelName: tunnel.name
            });
            res.status(500).send('Internal tunnel error');
        }
    });

    req.on('error', (err) => {
        logWithTimestamp('ERROR', `Request error for tunnel ${tunnel.id}`, {
            error: err.message,
            requestId: requestId.substring(0, 8),
            tunnelName: tunnel.name
        });
        if (pendingResponses.has(requestId)) {
            storeRespData(analyticsId, 400, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);
            res.status(400).send('Bad request');
            pendingResponses.delete(requestId);
        }
    });
});

// Process metrics buffer every 2 minutes
setInterval(() => {
    logWithTimestamp('INFO', `🔄 Scheduled metrics processing`, {
        bufferSize: metricsBuffer.length,
        uniqueTunnelsWithIps: uniqueIpsBuffer.size
    });
    processMetricsBuffer();
}, 2 * 60 * 1000);

// Clean up old live stats every 10 minutes
setInterval(async () => {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        const result = await prisma.liveStats.updateMany({
            where: {
                lastUpdated: {
                    lt: tenMinutesAgo
                }
            },
            data: {
                requestsLast5Min: 0,
                requestsLast1Hour: 0
            }
        });

        if (result.count > 0) {
            logWithTimestamp('INFO', `🧹 Cleaned up old live stats`, {
                recordsUpdated: result.count,
                cutoffTime: tenMinutesAgo.toISOString()
            });
        }
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to clean up old live stats', {
            error: error.message
        });
    }
}, 10 * 60 * 1000);

// Daily aggregation job (run once per day at midnight)
async function generateDailyStats() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date(yesterday);
    today.setDate(today.getDate() + 1);

    logWithTimestamp('INFO', `📊 Starting daily stats generation`, {
        date: yesterday.toDateString(),
        dateRange: `${yesterday.toISOString()} to ${today.toISOString()}`
    });

    try {
        const hourlyStats = await prisma.hourlyStats.findMany({
            where: {
                hour: {
                    gte: yesterday,
                    lt: today
                }
            }
        });

        logWithTimestamp('INFO', `Found ${hourlyStats.length} hourly stats records for processing`);

        // Group by tunnel
        const tunnelGroups = new Map();
        hourlyStats.forEach(stat => {
            if (!tunnelGroups.has(stat.tunnelId)) {
                tunnelGroups.set(stat.tunnelId, []);
            }
            tunnelGroups.get(stat.tunnelId).push(stat);
        });

        logWithTimestamp('INFO', `Grouped into ${tunnelGroups.size} tunnels for daily aggregation`);

        // Create daily stats for each tunnel
        for (const [tunnelId, stats] of tunnelGroups) {
            const totalRequests = stats.reduce((sum, s) => sum + s.totalRequests, 0);
            const successRequests = stats.reduce((sum, s) => sum + s.successRequests, 0);
            const errorRequests = stats.reduce((sum, s) => sum + s.errorRequests, 0);
            const avgResponseTime = stats.reduce((sum, s) => sum + s.avgResponseTime, 0) / stats.length;
            const totalBandwidth = stats.reduce((sum, s) => sum + BigInt(s.totalBandwidth), BigInt(0));
            const uniqueIps = stats.reduce((sum, s) => sum + s.uniqueIps, 0);

            // Find peak hour
            const peakHourStat = stats.reduce((max, current) =>
                current.totalRequests > max.totalRequests ? current : max
            );
            const peakHour = peakHourStat.hour.getHours();

            logWithTimestamp('INFO', `📈 Creating daily stats for tunnel ${tunnelId}`, {
                date: yesterday.toDateString(),
                totalRequests,
                successRequests,
                errorRequests,
                errorRate: `${((errorRequests / totalRequests) * 100).toFixed(1)}%`,
                avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
                totalBandwidth: formatBytes(Number(totalBandwidth)),
                uniqueIps,
                peakHour: `${peakHour}:00`,
                hoursWithData: stats.length
            });

            const dailyStats = await prisma.dailyStats.upsert({
                where: {
                    tunnelId_date: { tunnelId, date: yesterday }
                },
                create: {
                    tunnelId,
                    date: yesterday,
                    totalRequests,
                    successRequests,
                    errorRequests,
                    avgResponseTime,
                    totalBandwidth,
                    uniqueIps,
                    peakHour,
                },
                update: {
                    totalRequests,
                    successRequests,
                    errorRequests,
                    avgResponseTime,
                    totalBandwidth,
                    uniqueIps,
                    peakHour,
                }
            });

            logWithTimestamp('SUCCESS', `💾 Daily stats saved for tunnel ${tunnelId}`, {
                recordId: dailyStats.id || 'updated'
            });
        }

        logWithTimestamp('SUCCESS', `✅ Daily stats generation completed`, {
            date: yesterday.toDateString(),
            tunnelsProcessed: tunnelGroups.size,
            totalHourlyRecords: hourlyStats.length
        });

    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to generate daily stats', {
            date: yesterday.toDateString(),
            error: error.message,
            stack: error.stack
        });
    }
}

// Schedule daily stats generation at midnight
const now = new Date();
const midnight = new Date(now);
midnight.setHours(24, 0, 0, 0);
const msUntilMidnight = midnight.getTime() - now.getTime();

logWithTimestamp('INFO', `📅 Scheduling daily stats generation`, {
    nextRun: midnight.toISOString(),
    msUntilMidnight: `${Math.round(msUntilMidnight / 1000 / 60)} minutes`
});

setTimeout(() => {
    generateDailyStats();
    // Then run daily
    setInterval(generateDailyStats, 24 * 60 * 60 * 1000);
}, msUntilMidnight);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    logWithTimestamp('SUCCESS', `🚇 Tunnel server with analytics running`, {
        port: PORT,
        url: `http://localhost:${PORT}`,
        metricsBufferLimit: 100,
        metricsProcessingInterval: '2 minutes',
        liveStatsCleanup: '10 minutes',
        dailyStatsGeneration: 'midnight'
    });
});

// Show current status periodically
setInterval(() => {
    if (agents.size > 0) {
        logWithTimestamp('INFO', `📊 Server status update`, {
            activeAgents: agents.size,
            tunnelIds: Array.from(agents.keys()),
            pendingResponses: pendingResponses.size,
            metricsBufferSize: metricsBuffer.length,
            uniqueIpsTracked: uniqueIpsBuffer.size,
            activeRequests: activeRequests.size,
            uptime: `${Math.round(process.uptime())} seconds`
        });
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
    logWithTimestamp('INFO', '🛑 Received SIGTERM, gracefully shutting down...');

    // Process any remaining metrics
    if (metricsBuffer.length > 0) {
        logWithTimestamp('INFO', `Processing ${metricsBuffer.length} remaining metrics before shutdown...`);
        await processMetricsBuffer();
    }

    // Close all WebSocket connections
    agents.forEach((ws, tunnelId) => {
        logWithTimestamp('INFO', `Closing connection for tunnel: ${tunnelId}`);
        ws.close(1000, 'Server shutting down');
    });

    // Close database connection
    await prisma.$disconnect();

    // Close HTTP server
    server.close(() => {
        logWithTimestamp('SUCCESS', '✅ Server shut down gracefully');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    logWithTimestamp('INFO', '🛑 Received SIGINT, gracefully shutting down...');

    // Process any remaining metrics
    if (metricsBuffer.length > 0) {
        logWithTimestamp('INFO', `Processing ${metricsBuffer.length} remaining metrics before shutdown...`);
        await processMetricsBuffer();
    }

    // Close all WebSocket connections
    agents.forEach((ws, tunnelId) => {
        logWithTimestamp('INFO', `Closing connection for tunnel: ${tunnelId}`);
        ws.close(1000, 'Server shutting down');
    });

    // Close database connection
    await prisma.$disconnect();

    // Close HTTP server
    server.close(() => {
        logWithTimestamp('SUCCESS', '✅ Server shut down gracefully');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logWithTimestamp('ERROR', '💥 Uncaught Exception', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logWithTimestamp('ERROR', '💥 Unhandled Rejection', {
        reason: reason.toString(),
        promise: promise.toString()
    });
    process.exit(1);
});

// Memory usage monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const formatMB = (bytes) => Math.round(bytes / 1024 / 1024 * 100) / 100;

    // Log memory usage if it's getting high
    if (memUsage.heapUsed > 100 * 1024 * 1024) { // > 100MB
        logWithTimestamp('WARN', '🧠 High memory usage detected', {
            heapUsed: `${formatMB(memUsage.heapUsed)} MB`,
            heapTotal: `${formatMB(memUsage.heapTotal)} MB`,
            rss: `${formatMB(memUsage.rss)} MB`,
            external: `${formatMB(memUsage.external)} MB`,
            metricsBufferSize: metricsBuffer.length,
            activeRequests: activeRequests.size,
            pendingResponses: pendingResponses.size
        });
    }
}, 60 * 1000); // Every minute

// Export for testing or external use
export default server;