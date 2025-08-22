const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const COLOR_PRESETS = {
    white: '#fff',
    gray: '#888'
};

function parseColor(input) {
    if (!input) return COLOR_PRESETS.white;
    const lower = input.toLowerCase();
    if (COLOR_PRESETS[lower]) return COLOR_PRESETS[lower];
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input)) return input;
    if (/^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i.test(input)) return input;
    try {
        const ctx = createCanvas(1, 1).getContext('2d');
        ctx.fillStyle = input;
        if (ctx.fillStyle !== '') return ctx.fillStyle;
    } catch {}
    return COLOR_PRESETS.white;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('speechify')
        .setDescription('Add a speech bubble to an image!')
        .setIntegrationTypes([0, 1])
        .setContexts([0, 1, 2])
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Image')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Text')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('side')
                .setDescription('Bubble tail side')
                .setRequired(false)
                .addChoices(
                    { name: 'left', value: 'left' },
                    { name: 'right', value: 'right' }
                )
        )
        .addNumberOption(option =>
            option.setName('height')
                .setDescription('Bubble height as % (Enter as numbers only)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Bubble color')
                .setRequired(false)
        )
        .addNumberOption(option =>
            option.setName('size')
                .setDescription('Size multiplier')
                .setRequired(false)
        ),
    async execute(interaction) {
        const attachment = interaction.options.getAttachment('image');
        const text = interaction.options.getString('text') || '';
        const side = interaction.options.getString('side') || (Math.random() < 0.5 ? 'left' : 'right');
        const heightPercent = interaction.options.getNumber('height') || 18;
        const colorInput = interaction.options.getString('color');
        const color = parseColor(colorInput);
        const sizeMultiplier = interaction.options.getNumber('size') || 1;

        if (!attachment || !SUPPORTED_IMAGE_TYPES.includes(attachment.contentType)) {
            return interaction.reply({ content: 'File must be jpg, png, webp or gif' });
        }
        if (attachment.contentType === 'image/gif' && attachment.size > 10 * 1024 * 1024) {
            return interaction.reply({ content: 'Must be under 10MB.'});
        }

        await interaction.deferReply();

        try {
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            let img, width, height, bubbleMultiplier;
            if (attachment.contentType === 'image/gif') {
                const { GifReader } = require('omggif');
                const gif = new GifReader(buffer);
                const frameCanvas = createCanvas(gif.width, gif.height);
                const frameCtx = frameCanvas.getContext('2d');
                const imageData = frameCtx.createImageData(gif.width, gif.height);
                gif.decodeAndBlitFrameRGBA(0, imageData.data); // Only first frame
                frameCtx.putImageData(imageData, 0, 0);
                img = frameCanvas;
                width = Math.floor(gif.width * sizeMultiplier);
                height = Math.floor(gif.height * sizeMultiplier);
                bubbleMultiplier = sizeMultiplier;
            } else {
                img = await loadImage(buffer);
                width = Math.floor(img.width * sizeMultiplier);
                height = Math.floor(img.height * sizeMultiplier);
                bubbleMultiplier = sizeMultiplier;
            }

            if (width > 512 || height > 512) {
                const aspect = width / height;
                if (aspect > 1) {
                    width = 512;
                    height = Math.round(512 / aspect);
                } else {
                    height = 512;
                    width = Math.round(512 * aspect);
                }
                bubbleMultiplier = 1;
            }

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const bubbleHeight = Math.floor(height * (heightPercent / 100));
            const bubbleWidth = width + 30 * bubbleMultiplier;
            const bubbleX = -15 * bubbleMultiplier;
            const bubbleY = 0;
            const radius = Math.floor(bubbleHeight * 0.45);

            ctx.save();
            ctx.globalAlpha = 1;
            ctx.fillStyle = color;
            ctx.strokeStyle = '#000';
            ctx.lineWidth = Math.max(4, Math.floor(width * 0.012));
            ctx.beginPath();
            ctx.moveTo(bubbleX + radius, bubbleY);
            ctx.lineTo(bubbleX + bubbleWidth - radius, bubbleY);
            ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY, bubbleX + bubbleWidth, bubbleY + radius);
            ctx.lineTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight - radius);
            ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight, bubbleX + bubbleWidth - radius, bubbleY + bubbleHeight);
            ctx.lineTo(bubbleX + radius, bubbleY + bubbleHeight);
            ctx.quadraticCurveTo(bubbleX, bubbleY + bubbleHeight, bubbleX, bubbleY + bubbleHeight - radius);
            ctx.lineTo(bubbleX, bubbleY + radius);
            ctx.quadraticCurveTo(bubbleX, bubbleY, bubbleX + radius, bubbleY);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            if (side === 'left') {
                ctx.moveTo(bubbleX + bubbleWidth * 0.18, bubbleY + bubbleHeight);
                ctx.lineTo(bubbleX + bubbleWidth * 0.18 - bubbleWidth * 0.08, bubbleY + bubbleHeight + bubbleHeight * 0.7);
                ctx.lineTo(bubbleX + bubbleWidth * 0.18 + bubbleWidth * 0.08, bubbleY + bubbleHeight);
            } else {
                ctx.moveTo(bubbleX + bubbleWidth * 0.82, bubbleY + bubbleHeight);
                ctx.lineTo(bubbleX + bubbleWidth * 0.82 - bubbleWidth * 0.08, bubbleY + bubbleHeight + bubbleHeight * 0.7);
                ctx.lineTo(bubbleX + bubbleWidth * 0.82 + bubbleWidth * 0.08, bubbleY + bubbleHeight);
            }
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.strokeStyle = '#000';
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            if (text) {
                ctx.save();
                ctx.font = `bold ${Math.floor(bubbleHeight * 0.45)}px Arial`;
                ctx.fillStyle = '#222';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                const textX = bubbleX + bubbleWidth / 2;
                const textY = bubbleY + bubbleHeight / 2;
                ctx.fillText(text, textX, textY, bubbleWidth - 40);
                ctx.restore();
            }

            const outBuffer = canvas.toBuffer('image/png');
            const outAttachment = new AttachmentBuilder(outBuffer, { name: 'speechified.png' });
            ctx.clearRect(0, 0, width, height);
            canvas.width = 0;
            canvas.height = 0;

            await interaction.editReply({
                files: [outAttachment],
                content: attachment.contentType === 'image/gif'
                    ? '-# GIFs are converted to PNG (first frame only, no animation)'
                    : (width === 512 || height === 512
                        ? '-# Max 512x512, to not make the bot explode'
                        : undefined)
            });
        } catch (err) {
            await interaction.editReply({ content: 'Failed to process...' });
        }
    },
};