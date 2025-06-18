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

// Analytics middleware
async function captureRequestMetrics(req, res, agentId) {
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

        // Capture metrics
        captureMetrics(requestId, statusCode, responseTime, responseSize);

        return originalSend.call(this, data);
    };

    return requestId;
}

async function captureMetrics(requestId, statusCode, responseTime, responseSize) {
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

    // Track unique IPs per tunnel
    if (!uniqueIpsBuffer.has(agentId)) {
        uniqueIpsBuffer.set(agentId, new Set());
    }
    uniqueIpsBuffer.get(agentId).add(clientIp);

    // Update live stats immediately
    await updateLiveStats(agentId, metric);

    // Process buffer if it's getting large
    if (metricsBuffer.length >= 100) {
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
        await prisma.liveStats.upsert({
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
    } catch (error) {
        console.error('Failed to update live stats:', error);
    }
}

// Process buffered metrics
async function processMetricsBuffer() {
    if (metricsBuffer.length === 0) return;

    console.log(`📊 Processing ${metricsBuffer.length} metrics...`);

    // Group metrics by tunnel and hour
    const hourlyGroups = new Map();

    for (const metric of metricsBuffer) {
        const hourKey = `${metric.tunnelId}-${getHourKey(metric.timestamp)}`;
        if (!hourlyGroups.has(hourKey)) {
            hourlyGroups.set(hourKey, []);
        }
        hourlyGroups.get(hourKey).push(metric);
    }

    // Process each hourly group
    for (const [hourKey, metrics] of hourlyGroups) {
        await updateHourlyStats(hourKey, metrics);
    }

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

    try {
        await prisma.hourlyStats.upsert({
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
    } catch (error) {
        console.error('Failed to update hourly stats:', error);
    }
}

// Helper function to create hour key
function getHourKey(date) {
    const hour = new Date(date);
    hour.setMinutes(0, 0, 0);
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
        return data.countryCode || 'UNKNOWN';
    } catch (error) {
        console.error('Failed to get country for IP:', ip, error);
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
                    console.log(`⚠️ Kicked old agent with ID: ${wsAgentId}`);
                }

                agents.set(wsAgentId, ws);
                console.log(`[+] Agent registered: ${wsAgentId} (user: ${user.email || user.userId || 'unknown'})`);
            } catch (err) {
                console.error(`❌ Invalid token for agent "${agentId}":`, err.message);
                ws.close(4001, 'Authentication failed');
            }

            return;
        }

        if (msg.type === 'response') {
            const { id, statusCode, headers, body } = msg;
            const res = pendingResponses.get(id);

            if (!res) {
                console.warn(`⚠️ No pending response found for ID: ${id}`);
                return;
            }

            res.set(headers);
            res.status(statusCode).send(body);
            pendingResponses.delete(id);
        }
    });

    ws.on('close', () => {
        if (wsAgentId) {
            console.log(`[-] Agent disconnected: ${wsAgentId}`);
            agents.delete(wsAgentId);
        }
    });

    ws.on('error', (err) => {
        console.error(`❌ WebSocket error for agent ${wsAgentId || 'unknown'}:`, err.message);
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
        return res.status(404).send(`No tunnel found for agent ID: "${agentId}"`);
    }

    // Start analytics tracking
    const analyticsId = await captureRequestMetrics(req, res, agentId);
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
                    captureMetrics(analyticsId, 504, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);

                    res.status(504).send('Request timed out');
                    pendingResponses.delete(requestId);
                    console.warn(`⏱️ Timeout on request ID: ${requestId}`);
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
            captureMetrics(analyticsId, 500, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);

            console.error(`❌ Failed to send request to agent:`, err.message);
            res.status(500).send('Internal tunnel error');
        }
    });

    req.on('error', (err) => {
        console.error(`❌ Request error:`, err.message);
        if (pendingResponses.has(requestId)) {
            captureMetrics(analyticsId, 400, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);
            res.status(400).send('Bad request');
            pendingResponses.delete(requestId);
        }
    });
});

// Process metrics buffer every 2 minutes
setInterval(processMetricsBuffer, 2 * 60 * 1000);

// Clean up old live stats every 10 minutes
setInterval(async () => {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        await prisma.liveStats.updateMany({
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
    } catch (error) {
        console.error('Failed to clean up old live stats:', error);
    }
}, 10 * 60 * 1000);

// Daily aggregation job (run once per day at midnight)
async function generateDailyStats() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date(yesterday);
    today.setDate(today.getDate() + 1);

    try {
        const hourlyStats = await prisma.hourlyStats.findMany({
            where: {
                hour: {
                    gte: yesterday,
                    lt: today
                }
            }
        });

        // Group by tunnel
        const tunnelGroups = new Map();
        hourlyStats.forEach(stat => {
            if (!tunnelGroups.has(stat.tunnelId)) {
                tunnelGroups.set(stat.tunnelId, []);
            }
            tunnelGroups.get(stat.tunnelId).push(stat);
        });

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

            await prisma.dailyStats.upsert({
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
        }

        console.log(`📊 Generated daily stats for ${tunnelGroups.size} tunnels`);
    } catch (error) {
        console.error('Failed to generate daily stats:', error);
    }
}

// Schedule daily stats generation at midnight
const now = new Date();
const midnight = new Date(now);
midnight.setHours(24, 0, 0, 0);
const msUntilMidnight = midnight.getTime() - now.getTime();

setTimeout(() => {
    generateDailyStats();
    // Then run daily
    setInterval(generateDailyStats, 24 * 60 * 60 * 1000);
}, msUntilMidnight);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚇 Tunnel server with analytics running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 Processing remaining metrics before shutdown...');
    await processMetricsBuffer();
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Processing remaining metrics before shutdown...');
    await processMetricsBuffer();
    await prisma.$disconnect();
    process.exit(0);
});