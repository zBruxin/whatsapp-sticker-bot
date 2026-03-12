const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const sharp = require('sharp')
const QRCode = require('qrcode')
const fs = require('fs')

async function startBot() {
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Bot', 'Chrome', '1.0'],
        logger: require('pino')({ level: 'silent' }),
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            await QRCode.toFile('qrcode.png', qr, { width: 400 })
            console.log('✅ QR Code gerado! Abra o arquivo qrcode.png e escaneie.')
        }

        if (connection === 'close') {
            const code = (lastDisconnect?.error)?.output?.statusCode
            if (code !== DisconnectReason.loggedOut) {
                console.log('Reconectando...')
                startBot()
            } else {
                console.log('Deslogado. Delete a pasta auth_info e reinicie.')
            }
        }

        if (connection === 'open') {
            console.log('🤖 Bot conectado!')
            if (fs.existsSync('qrcode.png')) fs.unlinkSync('qrcode.png')
        }
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if (!msg.message) return
        if (msg.key.fromMe && Object.keys(msg.message)[0] === 'stickerMessage') return

        const from = msg.key.remoteJid
        const type = Object.keys(msg.message)[0]
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
        const cmd = body.trim().toLowerCase()
        console.log(`📨 [${type}] de ${from}: ${cmd || '(mídia)'}`)

        if (cmd === '!ping') {
            await sock.sendMessage(from, { text: '🏓 Pong!' })
            return
        }

        if (cmd === '!menu' || cmd === '!ajuda') {
            await sock.sendMessage(from, {
                text: `🤖 *Bot de Figurinhas*\n\n` +
                    `🖼️ *!figurinha* — envie imagem com essa legenda\n` +
                    `🔄 *!converter* — converte imagem/WebP em figurinha\n` +
                    `   _Envie imagem com !converter na legenda_\n` +
                    `🔤 *!fig texto* — figurinha com texto\n` +
                    `   _Ex: !fig Boa noite!_\n` +
                    `🏓 *!ping* — testa o bot`
            })
            return
        }

        // !figurinha — imagem normal ou documento
        const isImage = type === 'imageMessage' && msg.message.imageMessage?.caption?.toLowerCase().startsWith('!figurinha')
        const isDocument = type === 'documentMessage' && msg.message.documentMessage?.caption?.toLowerCase().startsWith('!figurinha')

        if (isImage || isDocument) {
            try {
                await sock.sendMessage(from, { text: '⏳ Criando figurinha...' })
                const { downloadMediaMessage } = require('@whiskeysockets/baileys')
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
                const sticker = await sharp(buffer)
                    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .webp({ quality: 80 })
                    .toBuffer()
                await sock.sendMessage(from, { sticker, mimetype: 'image/webp' })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao criar figurinha.' })
            }
            return
        }

        // !converter — figurinha WebP, imagem com !converter ou documento com !converter
        const isConverterImage = type === 'imageMessage' && msg.message.imageMessage?.caption?.toLowerCase() === '!converter'
        const isConverterDoc = type === 'documentMessage' && msg.message.documentMessage?.caption?.toLowerCase() === '!converter'
        const isSticker = type === 'stickerMessage'

        if (isSticker || isConverterImage || isConverterDoc) {
            try {
                await sock.sendMessage(from, { text: '⏳ Convertendo imagem...' })
                const { downloadMediaMessage } = require('@whiskeysockets/baileys')
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
                const sticker = await sharp(buffer)
                    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .webp({ quality: 80 })
                    .toBuffer()
                await sock.sendMessage(from, { sticker, mimetype: 'image/webp' })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao converter.' })
            }
            return
        }

        // !fig texto
        if (cmd.startsWith('!fig ')) {
            const texto = body.trim().slice(5).trim()
            try {
                await sock.sendMessage(from, { text: '⏳ Criando figurinha...' })
                const lines = texto.match(/.{1,16}/g) || [texto]
                const svgLines = lines.map((line, i) =>
                    `<text x="256" y="${80 + i * 80}" font-size="60" font-family="Arial" font-weight="bold"
                     text-anchor="middle" fill="white" stroke="black" stroke-width="8" paint-order="stroke">
                     ${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`
                ).join('')
                const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
                    <rect width="512" height="512" fill="transparent"/>
                    ${svgLines}
                </svg>`
                const sticker = await sharp(Buffer.from(svg))
                    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .webp({ quality: 80 })
                    .toBuffer()
                await sock.sendMessage(from, { sticker, mimetype: 'image/webp' })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao criar figurinha de texto.' })
            }
            return
        }
    })
}

startBot()