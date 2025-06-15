Tunnel Project: Self-Hosted Reverse Proxy (Ngrok Alternative)

A monorepo implementation of a self-hosted tunneling solution that mimics the functionality of tools like Ngrok. It provides a command-line agent to expose local servers and a tunnel server to route and manage public HTTP traffic through WebSocket connections.

⸻

📦 Repository Structure

tunnel-project/
├── agent/     # CLI tool to expose localhost ports to the public tunnel server
│   ├── bin/
│   ├── lib/
│   ├── package.json
│   └── README.md
│
├── server/    # Tunnel server that accepts public requests and forwards them
│   ├── server.js
│   ├── package.json
│   └── README.md
│
├── package.json  # (Optional) Root package config if using npm workspaces
├── .gitignore
└── README.md     # This file


⸻

🚀 Getting Started

Prerequisites
	•	Node.js v18 or above
	•	npm (Node Package Manager)

1. Clone the Repository

git clone https://github.com/yourusername/tunnel-project.git
cd tunnel-project

2. Start the Tunnel Server

cd server
npm install
node tunnel-server.js

This will start the public tunnel server on http://localhost:8080.

3. Start the Local Agent

cd ../agent
npm install
node bin/cli.js expose --port 3000 --name yourname

Now, your local service running on port 3000 is accessible at:

http://localhost:8080/yourname/


⸻

🧠 How It Works

Tunnel Server
	•	Hosts a WebSocket server for incoming agent connections.
	•	Hosts an HTTP server to accept external requests.
	•	Maps each agentId to a connected WebSocket.
	•	Routes requests to the correct agent via WebSocket.

Agent
	•	Connects to the tunnel server over WebSocket.
	•	Registers using a unique name/agentId.
	•	Listens for request payloads and forwards them to localhost:{port}.
	•	Sends back the HTTP response to the tunnel server.

⸻

📌 Features
	•	✅ Agent auto-registration
	•	✅ Port-to-path mapping (e.g., /yourname/*)
	•	✅ WebSocket communication
	•	✅ Request/response forwarding
	•	✅ Timeout handling (10s default)

⸻

🔧 Development

To work with both the agent and server simultaneously, you can use concurrently:

npm install -g concurrently
concurrently "cd server && node tunnel-server.js" "cd agent && node bin/cli.js expose --port 3000 --name yourname"


⸻

📈 Roadmap
	•	HTTPS support
	•	WebSocket tunnels
	•	UI Dashboard for tunnel monitoring
	•	Agent authentication via tokens
	•	Subdomain routing (e.g., yourname.tunnel.dev)
	•	Traffic analytics & logging

⸻

📄 License

This project is licensed under the MIT License.

⸻

👨‍💻 Author
- Pratik
- For any questions, feel free to [contact me](mailto:pvks5423@gmail.com).

For issues, suggestions or contributions, feel free to open an issue or submit a pull request.