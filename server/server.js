import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store: agentId => ws
const agents = new Map();

// Store: requestId => response res object
const pendingResponses = new Map();

// Handle agent WebSocket connections
wss.on('connection', (ws) => {
    let agentId = null;

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            return;
        }

        // Agent registration
        if (msg.type === 'register') {
            agentId = msg.agentId;
            console.log(`[+] Agent registered: ${agentId}`);
            agents.set(agentId, ws);
            return;
        }

        // Agent is sending back the response
        if (msg.type === 'response') {
            const { id, statusCode, headers, body } = msg;
            const res = pendingResponses.get(id);
            if (!res) return;

            // Forward response back to client
            res.set(headers);
            res.status(statusCode).send(body);
            pendingResponses.delete(id);
        }
    });

    ws.on('close', () => {
        if (agentId) {
            console.log(`[-] Agent disconnected: ${agentId}`);
            agents.delete(agentId);
        }
    });
});

// Public HTTP tunnel entry
app.use(async (req, res) => {

    const pathdata = req.path.split('/');
    console.log("path details : ", pathdata);

    const [_, agentId, ...restPath] = req.path.split('/');
    const path = '/' + restPath.join('/');
    const agent = agents.get(agentId);


    if (!agent) {
        return res.status(404).send(`No tunnel found for this agent, agent id : "${agentId}"`);
    }

    const id = uuidv4();

    // Collect request body
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        pendingResponses.set(id, res);

        agent.send(JSON.stringify({
            type: 'request',
            id,
            method: req.method,
            path,
            headers: req.headers,
            body
        }));

        // Timeout (optional)
        setTimeout(() => {
            if (pendingResponses.has(id)) {
                res.status(504).send('Request timed out');
                pendingResponses.delete(id);
            }
        }, 10000); // 10 seconds timeout
    });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🌐 Tunnel server running at http://localhost:${PORT}`);
});