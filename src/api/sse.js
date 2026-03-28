// =============================================================================
// 3K Nanobana — SSE (Server-Sent Events) Manager
// =============================================================================
// Manages SSE connections for real-time progress updates
// =============================================================================

const clients = new Set();

/**
 * Register a new SSE client
 */
function addClient(res) {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

    clients.add(res);
    console.log(`[SSE] Client connected. Total: ${clients.size}`);

    // Handle client disconnect
    res.on('close', () => {
        clients.delete(res);
        console.log(`[SSE] Client disconnected. Total: ${clients.size}`);
    });
}

/**
 * Broadcast an event to all connected clients
 */
function broadcast(event) {
    const data = JSON.stringify({ ...event, timestamp: Date.now() });
    const deadClients = [];

    clients.forEach(client => {
        try {
            client.write(`data: ${data}\n\n`);
        } catch (err) {
            deadClients.push(client);
        }
    });

    // Clean up dead connections
    deadClients.forEach(c => clients.delete(c));
}

/**
 * Get the number of connected clients
 */
function getClientCount() {
    return clients.size;
}

module.exports = {
    addClient,
    broadcast,
    getClientCount,
};
