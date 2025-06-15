#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startAgent } from '../lib/agent.js';


const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 expose --port <local-port> --name <unique-id>')
    .command('expose', 'Expose your localhost', {
        port: {
            describe: 'Local port to expose',
            demandOption: true,
            type: 'number'
        },
        name: {
            describe: 'Unique name/ID for your tunnel',
            demandOption: true,
            type: 'string'
        },
        server: {
            describe: 'Tunnel server URL',
            type: 'string',
            default: 'ws://localhost:8080'
        }
    })
    .help()
    .argv;

if (argv._[0] === 'expose') {
    startAgent(argv.port, argv.server, argv.name);
}