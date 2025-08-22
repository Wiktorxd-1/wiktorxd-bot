const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');


const devs = [
    '248462746717388802',
    '1092270202953142352',
    '385861959343669280',
    '478695604738981898',
    '332902199103586326'
];


const IGNORED_CHANNELS = [
    '1366538523876004011', '1366538381017878691', '1369760895756140574', '1366616480786944000',
    '1362861800181465098', '1366896038975111228', '1362398623094018048', '1361370195020484799',
    '1366658482299998228', '1360505111125823639', '1360509147057229964', '404040793720881154',
    '546227832326455306', '754150552874778734', '590249507044851715', '768403294715510826',
    '685592644428103744', '1223409821995241514', '1231850372725735485', '515584816100540427',
    '1212849311331909702', '590249311476908033', '922734290943504385', '404036514473836554',
    '608482797644152833', '1312221291884974202', '778765446110773310', '688897875345932365',
    '404014472533901312', '676981397763653632', '444932987881259028', '963289210503176242',
    '779548671263113217', '709115544468455474', '455877130367139866', '404014312651489292',
    '404014351893266432', '404014099920453633', '455405157216157716', '1214842766035517510',
    '775874980981768234', '1360355812756951120', '1213740016455524392', '1214431678559428628',
    '998201172995358890', '515591846693568513', '515585258356211732', '515585149140860930',
    '558467995299741696', '789580541845962783', '1046506754747404398', '1199439681293656226',
    '1373637048119988294'
];


function loadProcessedMessages() {
    try {
        if (fs.existsSync(path.join(__dirname, '../Data/messages.json'))) {
            return JSON.parse(fs.readFileSync(path.join(__dirname, '../Data/messages.json'), 'utf8')) || [];
        }
    } catch (e) { }
    return [];
}

function saveProcessedMessages(arr) {
    fs.writeFileSync(path.join(__dirname, '../Data/messages.json'), JSON.stringify(arr, null, 2));
}

function clearPings(content) {
    content = content.replace(/@everyone/g, '[everyone]');
    content = content.replace(/@here/g, '[here]');
    content = content.replace(/<@&\d+>/g, '[role]');
    content = content.replace(/<@!?(\d+)>/g, '[user]');
    return content;
}

function formatAndSplitDevMessage({ username, tag, content, imageUrl, messageUrl, referencedMessage }) {
    let baseMsg = `## New message by a developer\n\n`;

    if (referencedMessage) {
        const replyContent = referencedMessage.content || '[No content]';
        const replyAuthor = referencedMessage.author.global_name || referencedMessage.author.username;
        const replyNick = referencedMessage.author.username;
        baseMsg += `**Reply to:** ${replyAuthor} (${replyNick})\n> ${replyContent}\n\n`;
    }

    baseMsg += `**Message from:** ${username} (${tag})\n> ${content}\n\n`;
    baseMsg += `**Message link:** [Here](${messageUrl})`;


    const chunks = [];
    let msg = baseMsg;
    while (msg.length > 2000) {

        let splitAt = msg.lastIndexOf('\n', 2000);
        if (splitAt === -1) splitAt = msg.lastIndexOf(' ', 2000);
        if (splitAt === -1) splitAt = 2000;
        chunks.push(msg.slice(0, splitAt));
        msg = msg.slice(splitAt);
    }
    if (msg.length > 0) chunks.push(msg);


    if (chunks.length > 1) {
        return chunks.map((chunk, i) => `**Part ${i + 1}/${chunks.length}**\n${chunk}`);
    } else {
        return chunks;
    }
}

async function fetchAllChannels() {
    const url = `https://discord.com/api/v9/guilds/350467905391034391/channels`;
    try {
        const res = await axios.get(url, {
            headers: {
                Authorization: 'token'
            }
        });
        return res.data.filter(c => c.type === 0 || c.type === 5);
    } catch (error) {
        if (error.response && (error.response.status === 429)) {
            const retryAfter = error.response.headers['retry-after'] || 1;
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return fetchAllChannels();
        }
        if (error.response && (error.response.status === 502 || error.response.status === 503 || error.response.status === 504)) {
            return [];
        }
        return [];
    }
}

async function fetchMessages(channelId, limit = 50) {
    const url = `https://discord.com/api/v9/channels/${channelId}/messages?limit=${limit}`;
    try {
        const res = await axios.get(url, {
            headers: {
                Authorization: 'token'
            }
        });
        return res.data;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            const retryAfter = error.response.headers['retry-after'] || 1;
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            return fetchMessages(channelId, limit);
        }
        if (error.response && (error.response.status === 502 || error.response.status === 503 || error.response.status === 504)) {
            return [];
        }
        return [];
    }
}

async function loopScrape(client) {
    while (true) {
        try {
            await scrapeAllChannels(client);
        } catch (e) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function scrapeAllChannels(client) {
    let processed = loadProcessedMessages();
    let channels = [];
    try {
        channels = await fetchAllChannels();
    } catch (e) {
        return;
    }

    for (const channel of channels) {
        if (IGNORED_CHANNELS.includes(channel.id)) continue;
        try {
            const messages = await fetchMessages(channel.id, 30);
            const messageIds = messages.map(m => m.id);

            let changed = false;
            for (let i = processed.length - 1; i >= 0; i--) {
                if (processed[i].channel === channel.id && !messageIds.includes(processed[i].id)) {
                    processed.splice(i, 1);
                    changed = true;
                }
            }
            if (changed) saveProcessedMessages(processed);

            for (const msg of messages.reverse()) {
                const now = Date.now();
                const msgTimestamp = new Date(msg.timestamp).getTime();
                const diffMs = now - msgTimestamp;

                if (
                    msg.author &&
                    devs.includes(String(msg.author.id)) &&
                    !processed.find(m => m.id === msg.id && m.channel === channel.id) &&
                    diffMs <= 86400000
                ) {
                    const username = msg.author.username;
                    const tag = msg.author.discriminator && msg.author.discriminator !== "0"
                        ? `${msg.author.username}#${msg.author.discriminator}`
                        : (msg.author.global_name ? `${msg.author.global_name}` : msg.author.username);
                    const content = clearPings(msg.content || '');
                    const messageUrl = `https://discord.com/channels/350467905391034391/${channel.id}/${msg.id}`;
                    let imageUrl = null;
                    if (msg.attachments && msg.attachments.length > 0) {
                        const img = msg.attachments.find(a => a.content_type && a.content_type.startsWith('image/'));
                        if (img) imageUrl = img.url;
                    }

                    const devMessages = formatAndSplitDevMessage({
                        username,
                        tag,
                        content,
                        imageUrl,
                        messageUrl,
                        referencedMessage: msg.referenced_message || null
                    });

                    const targetChannelId = '1383389926535729254';
                    const discordChannel = await client.channels.fetch(targetChannelId).catch(() => null);
                    if (discordChannel) {
                        for (const devMsg of devMessages) {
                            try {
                                if (imageUrl && devMsg === devMessages[0]) {
                                    await discordChannel.send({
                                        content: devMsg,
                                        files: [imageUrl]
                                    });
                                } else {
                                    await discordChannel.send(devMsg);
                                }
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            } catch (sendError) {
                                if (sendError.code === 50001 || sendError.code === 50013) {
                                } else if (sendError.code === 429) {
                                    const retryAfter = sendError.headers && sendError.headers['retry-after'] ? sendError.headers['retry-after'] : 1;
                                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                                    await discordChannel.send(devMsg);
                                }
                            }
                        }
                    }

                    processed.push({ id: msg.id, channel: channel.id });
                    saveProcessedMessages(processed);
                }
            }
        } catch (e) {
            if (e.response && e.response.status === 429) {
                const retryAfter = e.response.headers['retry-after'] || 1;
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            }
        }
    }
}

module.exports = function startDevMsgWatcher(client) {
    if (client.isReady && client.isReady()) {
        loopScrape(client);
    } else {
        client.once('ready', async () => {
            loopScrape(client);
        });
    }
}