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

// In-memory store for active agents: agentId → WebSocket
const agents = new Map();
const pendingResponses = new Map(); // requestId → Express `res`

// Analytics buffer and tracking
const metricsBuffer = [];
const uniqueIpsBuffer = new Map(); // tunnelId → Set of IPs
const activeRequests = new Map(); // requestId → { startTime, agentId, req }

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

// Analytics middleware
async function storeReqData(req, res, agentId) {
    const startTime = Date.now();
    const requestId = uuidv4();

    // Store request info for later completion
    activeRequests.set(requestId, {
        startTime,
        agentId,
        req,
        path: req.path,
        method: req.method,
        clientIp: getClientIP(req),
        requestSize: parseInt(req.get('content-length') || '0')
    });

    logWithTimestamp('DEBUG', `📥 Incoming request`, {
        requestId: requestId.substring(0, 8),
        tunnelId: agentId,
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

    const { agentId, req, clientIp, requestSize } = requestData;

    // Get country from IP
    const country = await getCountryFromIP(clientIp);

    const metric = {
        tunnelId: agentId,
        path: req.path,
        method: req.method,
        country,
        statusCode,
        responseTime,
        requestSize,
        responseSize,
        clientIp,
        timestamp: new Date()
    };

    // Add to buffer
    metricsBuffer.push(metric);
    
    logWithTimestamp('INFO', `📊 Metric captured for tunnel ${agentId}`, {
        path: `${req.method} ${req.path}`,
        statusCode,
        responseTime: `${responseTime}ms`,
        country,
        bufferSize: metricsBuffer.length
    });

    // Track unique IPs per tunnel
    if (!uniqueIpsBuffer.has(agentId)) {
        uniqueIpsBuffer.set(agentId, new Set());
    }
    const wasNewIp = !uniqueIpsBuffer.get(agentId).has(clientIp);
    uniqueIpsBuffer.get(agentId).add(clientIp);
    
    if (wasNewIp) {
        logWithTimestamp('INFO', `🌍 New unique visitor for tunnel ${agentId}`, {
            country,
            totalUniqueIps: uniqueIpsBuffer.get(agentId).size
        });
    }

    // Update live stats immediately
    await updateLiveStats(agentId, metric);

    // Process buffer if it's getting large
    if (metricsBuffer.length >= 100) {
        logWithTimestamp('WARN', `Buffer size reached 100, processing metrics...`);
        processMetricsBuffer();
    }

    // Clean up
    activeRequests.delete(requestId);
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
                totalBandwidth,
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
                totalBandwidth: { increment: totalBandwidth },
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

// WebSocket connection handling (unchanged)
wss.on('connection', (ws) => {
    let wsAgentId = null;

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            console.warn('⚠️ Invalid JSON received from WebSocket');
            return;
        }

        if (msg.type === 'register') {
            const { agentId, token } = msg;

            try {
                console.log("token received on server:", token);
                const JWT_SECRET = process.env.JWT_SECRET.trim();
                console.log("jwt is:", JWT_SECRET);

                const user = jwt.verify(token, JWT_SECRET);
                ws.user = user;
                wsAgentId = agentId;

                if (agents.has(wsAgentId)) {
                    const oldWs = agents.get(wsAgentId);
                    oldWs.close(4002, 'Duplicate agent ID. Disconnected.');
                    logWithTimestamp('WARN', `Kicked old agent with duplicate ID: ${wsAgentId}`);
                }

                agents.set(wsAgentId, ws);
                logWithTimestamp('SUCCESS', `🔗 Agent registered`, {
                    agentId: wsAgentId,
                    user: user.email || user.userId || 'unknown',
                    totalActiveAgents: agents.size
                });
            } catch (err) {
                logWithTimestamp('ERROR', `Authentication failed for agent "${agentId}"`, {
                    error: err.message
                });
                ws.close(4001, 'Authentication failed');
            }

            return;
        }

        if (msg.type === 'response') {
            const { id, statusCode, headers, body } = msg;
            const res = pendingResponses.get(id);

            if (!res) {
                logWithTimestamp('WARN', `No pending response found for request ID: ${id}`);
                return;
            }

            res.set(headers);
            res.status(statusCode).send(body);
            pendingResponses.delete(id);
        }
    });

    ws.on('close', () => {
        if (wsAgentId) {
            logWithTimestamp('INFO', `🔌 Agent disconnected`, {
                agentId: wsAgentId,
                remainingActiveAgents: agents.size - 1
            });
            agents.delete(wsAgentId);
        }
    });

    ws.on('error', (err) => {
        logWithTimestamp('ERROR', `WebSocket error for agent ${wsAgentId || 'unknown'}`, {
            error: err.message
        });
    });
});

// HTTP tunnel endpoint with analytics
app.use(async (req, res) => {
    const pathParts = req.path.split('/').filter(part => part !== '');

    if (pathParts.length === 0) {
        return res.status(400).send('Invalid tunnel path');
    }

    const [agentId, ...rest] = pathParts;
    const targetPath = '/' + rest.join('/');
    const agent = agents.get(agentId);

    if (!agent) {
        logWithTimestamp('WARN', `No tunnel found for agent ID: "${agentId}"`);
        return res.status(404).send(`No tunnel found for agent ID: "${agentId}"`);
    }

    // Start analytics tracking
    const analyticsId = await storeReqData(req, res, agentId);
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

                    logWithTimestamp('WARN', `⏱️ Request timeout for tunnel ${agentId}`, {
                        requestId: requestId.substring(0, 8),
                        path: targetPath,
                        method: req.method
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

            logWithTimestamp('ERROR', `Failed to send request to agent ${agentId}`, {
                error: err.message,
                requestId: requestId.substring(0, 8)
            });
            res.status(500).send('Internal tunnel error');
        }
    });

    req.on('error', (err) => {
        logWithTimestamp('ERROR', `Request error for tunnel ${agentId}`, {
            error: err.message,
            requestId: requestId.substring(0, 8)
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
    const stats = {
        activeAgents: agents.size,
        pendingResponses: pendingResponses.size,
        metricsInBuffer: metricsBuffer.length,
        activeRequests: activeRequests.size,
        tunnelsWithUniqueIps: uniqueIpsBuffer.size,
        memoryUsage: {
            rss: formatBytes(process.memoryUsage().rss),
            heapUsed: formatBytes(process.memoryUsage().heapUsed)
        }
    };

    if (stats.activeAgents > 0 || stats.metricsInBuffer > 0) {
        logWithTimestamp('INFO', `📊 Server status update`, stats);
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
    logWithTimestamp('INFO', '🔄 Graceful shutdown initiated (SIGTERM)');
    logWithTimestamp('INFO', 'Processing remaining metrics before shutdown...');
    await processMetricsBuffer();
    await prisma.$disconnect();
    logWithTimestamp('SUCCESS', '✅ Shutdown complete');
    process.exit(0);
});

process.on('SIGINT', async () => {
    logWithTimestamp('INFO', '🔄 Graceful shutdown initiated (SIGINT)');
    logWithTimestamp('INFO', 'Processing remaining metrics before shutdown...');
    await processMetricsBuffer();
    await prisma.$disconnect();
    logWithTimestamp('SUCCESS', '✅ Shutdown complete');
    process.exit(0);
});