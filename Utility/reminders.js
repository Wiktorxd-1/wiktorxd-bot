const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const ms = require('ms');
const { EmbedBuilder } = require('discord.js');

const REMINDERS_FILE = path.resolve(__dirname, '..', 'Data', 'reminders.json');

function loadReminders() {
    const file = path.join(__dirname, '../Data/reminders.json');
    try {
        if (!fs.existsSync(file)) return [];
        const data = fs.readFileSync(file, 'utf8');
        if (!data.trim()) return [];
        return JSON.parse(data);
    } catch (e) {
        console.error('Error loading reminders:', e);
        return [];
    }
}

async function saveReminders(reminders) {
    try {
        await fsp.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving reminders:', error);
    }
}

function parseTime(timeString) {
    if (!timeString) return null;
    const timeInMs = ms(timeString.replace(/\s+/g, ''));
    console.log('parseTime:', timeString, '->', timeInMs);
    if (!timeInMs || timeInMs > max) {
        return null;
    }
    return timeInMs;
}

function formatTimeDifference(msDifference) {
    let seconds = Math.floor(msDifference / 1000);
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);
    let days = Math.floor(hours / 24);
    let weeks = Math.floor(days / 7);
    let months = Math.floor(days / 30.44);
    seconds %= 60;
    minutes %= 60;
    hours %= 24;
    days %= 7; 
    let parts = [];


    const addPart = (value, unitName) => {
        if (value > 0) {
            parts.push(`${value} ${unitName}${value === 1 ? '' : 's'}`);
        }
    };
    
    addPart(months, 'month');
    addPart(weeks, 'week');
    addPart(days, 'day');
    addPart(hours, 'hour');
    addPart(minutes, 'minute');

    if (parts.length === 0 || seconds > 0) {
        addPart(seconds, 'second');
    }

    return parts.join(', ');
}

async function sendReminder(client, reminder) {
    const user = await client.users.fetch(reminder.user).catch(() => null);
    if (!user) {
        console.warn(`Could not find user with ID ${reminder.user} to send reminder.`);
        return false;
    }

    const currentTime = Date.now();
    const timeSinceCreated = currentTime - (reminder.created_at || reminder.time_target);
    const footerText = `Reminder from ${formatTimeDifference(timeSinceCreated)} ago`;

    const embed = new EmbedBuilder()
        .setTitle('Reminder')
        .setDescription(reminder.reminder)
        .setColor('#FBE7BD')
        .setFooter({ text: footerText });


    if (reminder.attachment && reminder.attachment.url) {
        embed.setImage(reminder.attachment.url);
    } else if (reminder.image) {
        embed.setImage(reminder.image);
    }


    let files = [];
    if (reminder.attachment && reminder.attachment.url && reminder.attachment.name) {
        files.push({
            attachment: reminder.attachment.url,
            name: reminder.attachment.name
        });
    } else if (reminder.file && reminder.file.url && reminder.file.name) {
        files.push({
            attachment: reminder.file.url,
            name: reminder.file.name
        });
    }

    try {
        if (files.length > 0) {
            await user.send({ embeds: [embed], files });
        } else {
            await user.send({ embeds: [embed] });
        }
        console.log(`Sent reminder to ${user.tag} for "${reminder.reminder}"`);
        return true;
    } catch (error) {
        console.error(`Could not send reminder to ${user.tag} (ID: ${reminder.user}):`, error);
        return false;
    }
}

let reminderInterval;

async function startReminderChecker(client) {
    if (reminderInterval) {
        console.log('Reminder checker already running.');
        return;
    }

    const checkReminders = async () => {
        let reminders = await loadReminders();
        const now = Date.now();
        const sentReminderIndices = [];

        for (let i = 0; i < reminders.length; i++) {
            const reminder = reminders[i];
            if (now >= reminder.time_target) {
                const sent = await sendReminder(client, reminder);
                if (sent) {
                    sentReminderIndices.push(i);
                }
            }
        }

        if (sentReminderIndices.length > 0) {
            for (let i = sentReminderIndices.length - 1; i >= 0; i--) {
                reminders.splice(sentReminderIndices[i], 1);
            }
            await saveReminders(reminders);
        }
    };


    await checkReminders();
    reminderInterval = setInterval(checkReminders, 2000);
}

const max = ms('6mo');

function buildReminderEmbed(reminder) {
    const now = Date.now();
    const embed = new EmbedBuilder()
        .setTitle('⏰ Reminder')
        .setDescription(reminder.reminder)
        .setColor(0xFBE7BD)
        .setFooter({
            text: `Set ${timeAgo(reminder.created_at, now)}`
        });
    if (reminder.attachment) {
        embed.setImage(reminder.attachment.url);
    }
    return embed;
}


function timeAgo(from, to) {
    const diff = to - from;
    if (diff < 0) return 'in the future (WHAT)';
    if (diff < 60000) return `${Math.floor(diff / 1000)} second(s) ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minute(s) ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hour(s) ago`;
    return `${Math.floor(diff / 86400000)} day(s) ago`;
}

module.exports = {
    loadReminders,
    saveReminders,
    parseTime,
    formatTimeDifference,
    sendReminder,
    startReminderChecker,
    buildReminderEmbed
};