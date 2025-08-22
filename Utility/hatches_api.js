const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');
const NDJSON_PATH = path.join(__dirname, '..', 'Data', 'secrets.ndjson');

const RATE_LIMIT = 10;
let requestTimestamps = [];

function rateLimited(res) {
    const now = Date.now();
    requestTimestamps = requestTimestamps.filter(ts => now - ts < 1000);
    if (requestTimestamps.length >= RATE_LIMIT) {
        res.writeHead(429, { 'Content-Type': 'text/plain' });
        res.end('api is rate limited');
        return true;
    }
    requestTimestamps.push(now);
    return false;
}

function parseQueryParams(reqUrl) {
    const parsed = url.parse(reqUrl, true);
    const q = parsed.query;
    let num = 21;
    if (q.num !== undefined) {
        const parsedNum = parseInt(q.num, 10);
        if (!isNaN(parsedNum)) {
            num = Math.max(1, Math.min(100, parsedNum));
        }
    }
    const oldest = typeof q.oldest !== 'undefined';
    let afterId = null;
    if (q.after) {
        afterId = String(q.after);
    }
    const verified = typeof q.verified !== 'undefined';
    const username = q.username ? String(q.username).toLowerCase() : null;
    return { num, oldest, afterId, verified, username };
}

function usernameMatches(hatchData, username) {
    if (!username) return true;
    const hatchedByRaw = hatchData.hatchedBy || '';
    const hatchedByLower = hatchedByRaw.toLowerCase();
    let extractedRobloxUsername = '';
    const atUsernameMatch = hatchedByLower.match(/\(@([a-z0-9_]+)\)/);
    if (atUsernameMatch && atUsernameMatch[1]) {
        extractedRobloxUsername = atUsernameMatch[1];
    } else {
        const firstWordMatch = hatchedByLower.match(/^([a-z0-9_]+)/);
        if (firstWordMatch && firstWordMatch[1]) {
            extractedRobloxUsername = firstWordMatch[1];
        }
    }
    return extractedRobloxUsername.includes(username);
}

function streamHatches(res, { num, oldest, afterId, verified, username }) {
    if (username) {
        let foundAfter = !afterId;
        let sent = 0;
        const usernamesSet = new Set();
        let buffer = [];
        let finished = false;
        let firstUsername = null;
        const readStream = fs.createReadStream(NDJSON_PATH, { encoding: 'utf8' });
        let leftover = '';

        function extractRobloxUsername(parsed) {
            const hatchedByRaw = parsed.hatchedBy || '';
            const hatchedByLower = hatchedByRaw.toLowerCase();
            let extracted = '';
            const atUsernameMatch = hatchedByLower.match(/\(@([a-z0-9_]+)\)/);
            if (atUsernameMatch && atUsernameMatch[1]) {
                extracted = atUsernameMatch[1];
            } else {
                const firstWordMatch = hatchedByLower.match(/^([a-z0-9_]+)/);
                if (firstWordMatch && firstWordMatch[1]) {
                    extracted = firstWordMatch[1];
                }
            }
            return extracted;
        }

        readStream.on('data', chunk => {
            if (finished) return;
            leftover += chunk;
            let split = leftover.split('\n');
            leftover = split.pop();
            for (const line of split) {
                if (!line.trim()) continue;
                let parsed;
                try { parsed = JSON.parse(line); } catch { continue; }
                if (!foundAfter) {
                    if (parsed.id === afterId) {
                        foundAfter = true;
                        continue;
                    }
                    continue;
                }
                if (verified && !parsed.hatchedBy) continue;
                if (!usernameMatches(parsed, username)) continue;
                const robloxUsername = extractRobloxUsername(parsed);
                if (robloxUsername) {
                    usernamesSet.add(robloxUsername);
                    if (!firstUsername) firstUsername = robloxUsername;
                }
                if (usernamesSet.size > 1 && !afterId) {
                    if (buffer.length < 20) buffer.push(parsed);
                    if (buffer.length === 20) {
                        finished = true;
                        readStream.destroy();
                        break;
                    }
                } else {

                    buffer.push(parsed);
                }
            }
        });
        readStream.on('end', () => {
            if (leftover.trim() && foundAfter) {
                try {
                    const parsed = JSON.parse(leftover);
                    if ((!verified || parsed.hatchedBy) && usernameMatches(parsed, username)) {
                        const robloxUsername = extractRobloxUsername(parsed);
                        if (robloxUsername) {
                            usernamesSet.add(robloxUsername);
                            if (!firstUsername) firstUsername = robloxUsername;
                        }
                        if (usernamesSet.size > 1 && !afterId) {
                            if (buffer.length < 20) buffer.push(parsed);
                        } else {
                            buffer.push(parsed);
                        }
                    }
                } catch {}
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(buffer.reverse()));
        });
        readStream.on('error', err => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Could not read hatches file.');
        });
        return;
    }

    if (oldest) {
        let sent = 0;
        let foundAfter = !afterId;
        const jsonArr = [];
        const readStream = fs.createReadStream(NDJSON_PATH, { encoding: 'utf8' });
        let leftover = '';
        readStream.on('data', chunk => {
            leftover += chunk;
            let split = leftover.split('\n');
            leftover = split.pop();
            for (const line of split) {
                if (!line.trim()) continue;
                let parsed;
                try { parsed = JSON.parse(line); } catch { continue; }
                if (!foundAfter) {
                    if (parsed.id === afterId) {
                        foundAfter = true;
                        continue;
                    }
                    continue;
                }
                if (verified && !parsed.hatchedBy) continue;
                if (username && !usernameMatches(parsed, username)) continue;
                if (sent < num) {
                    jsonArr.push(parsed);
                    sent++;
                }
                if (sent >= num) {
                    readStream.destroy();
                    break;
                }
            }
        });
        readStream.on('end', () => {
            if (leftover.trim() && sent < num && foundAfter) {
                try {
                    const parsed = JSON.parse(leftover);
                    if ((!verified || parsed.hatchedBy) && (!username || usernameMatches(parsed, username))) {
                        jsonArr.push(parsed);
                    }
                } catch {}
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(jsonArr.reverse()));
        });
        readStream.on('close', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(jsonArr.reverse()));
        });
        readStream.on('error', err => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Could not read hatches file.');
        });
    } else {
        const stat = fs.statSync(NDJSON_PATH);
        const fd = fs.openSync(NDJSON_PATH, 'r');
        const chunkSize = 4096;
        let pos = stat.size;
        let buffer = '';
        let lines = [];
        let done = false;
        let foundAfter = !afterId;

        function readPrevChunk() {
            if (pos === 0 || done) {
                finish();
                return;
            }
            const readLen = Math.min(chunkSize, pos);
            pos -= readLen;
            const buf = Buffer.alloc(readLen);
            fs.readSync(fd, buf, 0, readLen, pos);
            buffer = buf.toString('utf8') + buffer;
            let split = buffer.split('\n');
            buffer = split.shift();
            for (let i = split.length - 1; i >= 0; i--) {
                const line = split[i].trim();
                if (!line) continue;
                let parsed;
                try { parsed = JSON.parse(line); } catch { continue; }
                if (!foundAfter) {
                    if (parsed.id === afterId) {
                        foundAfter = true;
                        continue;
                    }
                    continue;
                }
                if (verified && !parsed.hatchedBy) continue;
                if (username && !usernameMatches(parsed, username)) continue;
                lines.push(line);
                if (lines.length === num) {
                    done = true;
                    break;
                }
            }
            if (done || pos === 0) {
                if (buffer.trim()) {
                    let parsed;
                    try { parsed = JSON.parse(buffer.trim()); } catch { parsed = null; }
                    if (parsed && foundAfter && lines.length < num) {
                        if ((!verified || parsed.hatchedBy) && (!username || usernameMatches(parsed, username))) {
                            lines.push(buffer.trim());
                        }
                    }
                }
                finish();
            } else {
                setImmediate(readPrevChunk);
            }
        }

        function finish() {
            fs.closeSync(fd);
            let result = lines.reverse();
            const jsonArr = [];
            for (const l of result) {
                try { 
                    const parsed = JSON.parse(l);
                    jsonArr.push(parsed);
                } catch {}
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(jsonArr));
        }

        readPrevChunk();
    }
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function startHatchesApi() {
    const server = http.createServer((req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.url.startsWith('/hatches')) {
            if (rateLimited(res)) return;
            if (!fs.existsSync(NDJSON_PATH)) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('No hatches file found.');
                return;
            }
            const params = parseQueryParams(req.url);
            streamHatches(res, params);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found.');
        }
    });

    server.listen(2011, () => {
        console.log('Hatches API running on port 2011');
    });
}

module.exports = { startHatchesApi };