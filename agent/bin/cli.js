#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startAgent } from '../lib/agent.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.ngrok_clone_token.json');

const serverUrl = "http://localhost:3000"

/**
 * Convert ws:// or wss:// to http:// or https:// for API endpoints
 */
function toHttpUrl(serverUrl) {
    return "http://localhost:3000";
}

/**
 * Request a device code from the server
 */
async function requestDeviceCode(serverUrl) {
    const apiUrl = toHttpUrl(serverUrl);
    const response = await fetch(`${apiUrl}/api/auth/request-device-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to request device code: ${response.status} ${error}`);
    }
    const data = await response.json();
    if (!data.code || !data.url) {
        throw new Error('Invalid response from server - missing code or url');
    }
    return data;
}

/**
 * Poll the server for authentication status
 */
async function pollForAuth(serverUrl, code, maxAttempts = 30) {
    const apiUrl = toHttpUrl(serverUrl);
    console.log('Waiting for authentication...');
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const response = await fetch(`${apiUrl}/api/device/poll?code=${encodeURIComponent(code)}`, { method: 'GET' });
        if (response.ok) {
            const data = await response.json();
            if (data.token) {
                console.log('✅ Authentication successful!');
                return data.token;
            }
        } else if (response.status === 404) {
            throw new Error('Device code not found or expired');
        } else if (response.status === 429) {
            console.log('⏳ Rate limited, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        if (attempt % 5 === 0 && attempt > 0) {
            console.log(`⏳ Still waiting... (${attempt}/${maxAttempts})`);
        }
    }
    throw new Error('Authentication timed out. Please try again.');
}

/**
 * Complete authentication flow
 */
async function authenticate(serverUrl) {
    console.log('🔐 Starting authentication...');
    console.log("server : ", serverUrl)
    const { code, url, expiresIn } = await requestDeviceCode(serverUrl);
    console.log(`🔁 Polling for code: ${code} on server: ${serverUrl}`);

    // 1. Display instructions to user
    console.log('\n' + '='.repeat(60));
    console.log('🌐 AUTHENTICATION REQUIRED');
    console.log('='.repeat(60));
    console.log(`1. Open this URL in your browser:`);
    console.log(`   ${url}`);
    console.log(`\n2. Enter this code:`);
    console.log(`   ${code}`);
    console.log('='.repeat(60));
    console.log(`💡 Tip: The code will expire in ${Math.floor(expiresIn / 60)} minutes\n`);

    // 2. Poll for authentication
    const token = await pollForAuth(serverUrl, code);

    // 3. Store token securely
    const tokenData = {
        token,
        timestamp: Date.now(),
        serverUrl: toHttpUrl(serverUrl)
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
    console.log('💾 Token saved successfully!');
    return token;
}

/**
 * Get existing token or authenticate
 */
async function getToken(serverUrl) {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
            const tokenAge = Date.now() - (tokenData.timestamp || 0);
            const maxAge = 29 * 24 * 60 * 60 * 1000; // 29 days
            if (tokenData.token && tokenAge < maxAge) {
                console.log('✅ Using existing authentication token');
                return tokenData.token;
            } else {
                console.log('⚠️  Token expired, reauthenticating...');
            }
        } else {
            console.log('🔐 No token found, authenticating...');
        }
    } catch (error) {
        console.log('⚠️ Error reading token:', error.message);
    }

    // Only call authenticate ONCE here
    return await authenticate(serverUrl);
}

/**
 * Clear stored authentication
 */
function logout() {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
            console.log('✅ Logged out successfully!');
        } else {
            console.log('ℹ️  No authentication token found');
        }
    } catch (error) {
        console.error('❌ Failed to logout:', error.message);
    }
}

/**
 * Show current authentication status
 */
function showStatus() {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
            const tokenAge = Date.now() - (tokenData.timestamp || 0);
            const daysOld = Math.floor(tokenAge / (24 * 60 * 60 * 1000));
            console.log('✅ Authenticated');
            console.log(`   Server: ${tokenData.serverUrl || 'Unknown'}`);
            console.log(`   Token age: ${daysOld} days`);
            console.log(`   Expires: ${29 - daysOld} days remaining`);
        } else {
            console.log('❌ Not authenticated');
        }
    } catch (error) {
        console.log('⚠️  Authentication status unclear:', error.message);
    }
}

// CLI Configuration
const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 <command>')
    .command('expose', 'Expose your localhost', {
        port: { describe: 'Local port to expose', demandOption: true, type: 'number', alias: 'p' },
        name: { describe: 'Unique name/ID for your tunnel', demandOption: true, type: 'string', alias: 'n' },
        server: { describe: 'Tunnel server URL', type: 'string', default: 'ws://localhost:8080', alias: 's' }
    })
    .command('auth', 'Authenticate with the server', {
        server: { describe: 'Server URL', type: 'string', default: 'http://localhost:3000', alias: 's' }
    })
    .command('logout', 'Clear authentication token')
    .command('status', 'Show authentication status')
    .help()
    .alias('help', 'h')
    .version()
    .alias('version', 'v')
    .demandCommand(1, 'You must specify a command')
    .argv;

// Command handlers
const command = argv._[0];

(async () => {
    try {
        switch (command) {
            case 'expose':
                console.log(`🚀 Starting tunnel: localhost:${argv.port} → ${argv.name}`);
                const token = await getToken(argv.server);
                console.log('🔗 Establishing tunnel connection...');
                startAgent(argv.port, argv.server, argv.name, token);
                break;
            case 'auth':
                await authenticate(argv.server);
                console.log('🎉 Authentication complete!');
                break;
            case 'logout':
                logout();
                break;
            case 'status':
                showStatus();
                break;
            default:
                console.error('❌ Unknown command:', command);
                process.exit(1);
        }
    } catch (error) {
        console.error('❌ Unexpected error:', error.message);
        process.exit(1);
    }
})();