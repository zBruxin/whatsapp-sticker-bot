const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const sharp = require('sharp')
const QRCode = require('qrcode')
const fs = require('fs')
let modoConverter = false
let timerConverter = null

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
        const meuNumero = sock.user.id.split(':')[0] + '@s.whatsapp.net'
        if (from !== meuNumero) return
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

        // !converter — figurinha WebP, imagem com !converter ou modo sessão ativo
        const isConverterImage = type === 'imageMessage' && msg.message.imageMessage?.caption?.toLowerCase() === '!converter'
        const isConverterDoc = type === 'documentMessage' && msg.message.documentMessage?.caption?.toLowerCase() === '!converter'
        const isModoConverterAtivo = modoConverter && msg.key.fromMe && (type === 'imageMessage' || type === 'documentMessage')

        // ativa o modo sessão
        if (cmd === '!converter' && !modoConverter) {
            modoConverter = true
            await sock.sendMessage(from, { text: '🔄 Modo converter ativado! Manda as imagens que quiser.\nManda *!parar* pra desativar.' })
            return
        }

        // desativa o modo sessão
        if (cmd === '!parar' && modoConverter) {
            modoConverter = false
            if (timerConverter) clearTimeout(timerConverter)
            await sock.sendMessage(from, { text: '✅ Modo converter desativado!' })
            return
        }

        if ( isConverterImage || isConverterDoc || isModoConverterAtivo) {
            // renova o timer a cada imagem recebida
            if (modoConverter) {
                if (timerConverter) clearTimeout(timerConverter)
                timerConverter = setTimeout(async () => {
                    modoConverter = false
                    await sock.sendMessage(from, { text: '⏱️ Modo converter desativado por inatividade.' })
                }, 60000) // 60 segundos sem imagem desativa sozinho
            }

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

        // !jpg — converte imagem pra JPG
        const isJpg = type === 'imageMessage' && msg.message.imageMessage?.caption?.toLowerCase() === '!jpg'
        if (isJpg) {
            try {
                await sock.sendMessage(from, { text: '⏳ Convertendo para JPG...' })
                const { downloadMediaMessage } = require('@whiskeysockets/baileys')
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
                const jpg = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
                await sock.sendMessage(from, {
                    image: jpg,
                    mimetype: 'image/jpeg',
                })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao converter para JPG.' })
            }
            return
        }

        // !png — converte imagem pra PNG
        const isPng = type === 'imageMessage' && msg.message.imageMessage?.caption?.toLowerCase() === '!png'
        if (isPng) {
            try {
                await sock.sendMessage(from, { text: '⏳ Convertendo para PNG...' })
                const { downloadMediaMessage } = require('@whiskeysockets/baileys')
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
                const png = await sharp(buffer).png().toBuffer()
                await sock.sendMessage(from, {
                    image: png,
                    mimetype: 'image/png',
                })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao converter para PNG.' })
            }
            return
        }

       // !pdf — converte imagem pra PDF ou texto pra PDF
        const isPdf = type === 'imageMessage' && msg.message.imageMessage?.caption?.toLowerCase() === '!pdf'
        const isPdfTexto = cmd.startsWith('!pdf ') && type !== 'imageMessage'

        if (isPdfTexto) {
            const texto = body.trim().slice(5).trim()
            try {
                await sock.sendMessage(from, { text: '⏳ Gerando PDF...' })
                const PDFDocument = require('pdfkit')
                const pdf = await new Promise((resolve, reject) => {
                    const doc = new PDFDocument({ margin: 50 })
                    const chunks = []
                    doc.on('data', chunk => chunks.push(chunk))
                    doc.on('end', () => resolve(Buffer.concat(chunks)))
                    doc.on('error', reject)
                    doc.fontSize(14).text(texto, { align: 'left' })
                    doc.end()
                })
                await sock.sendMessage(from, {
                    document: pdf,
                    mimetype: 'application/pdf',
                    fileName: 'texto.pdf'
                })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao gerar PDF.' })
            }
            return
        }

        if (isPdf) {

            try {
                await sock.sendMessage(from, { text: '⏳ Convertendo para PDF...' })
                const { downloadMediaMessage } = require('@whiskeysockets/baileys')
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
                const { width, height } = await sharp(buffer).metadata()
                const PDFDocument = require('pdfkit')
                const pdf = await new Promise((resolve, reject) => {
                    const doc = new PDFDocument({ size: [width, height], margin: 0 })
                    const chunks = []
                    doc.on('data', chunk => chunks.push(chunk))
                    doc.on('end', () => resolve(Buffer.concat(chunks)))
                    doc.on('error', reject)
                    doc.image(buffer, 0, 0, { width, height })
                    doc.end()
                })
                await sock.sendMessage(from, {
                    document: pdf,
                    mimetype: 'application/pdf',
                    fileName: 'imagem.pdf'
                })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao converter para PDF.' })
            }
            return
        }

        // !fundo — remove fundo da imagem
        const isFundo = type === 'imageMessage' && msg.message.imageMessage?.caption?.toLowerCase() === '!fundo'
        if (isFundo) {
            try {
                await sock.sendMessage(from, { text: '⏳ Removendo fundo...' })
                const { downloadMediaMessage } = require('@whiskeysockets/baileys')
                const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
                const formData = new FormData()
                formData.append('image_file', new Blob([buffer]), 'image.png')
                formData.append('size', 'auto')
                const response = await fetch('https://api.remove.bg/v1.0/removebg', {
                    method: 'POST',
                    headers: { 'X-Api-Key': 'En3Gso6ygoQRs4wXz38dggpC' },
                    body: formData
                })
                if (!response.ok) throw new Error('Erro na API remove.bg')
                const result = Buffer.from(await response.arrayBuffer())
                await sock.sendMessage(from, {
                    image: result,
                    mimetype: 'image/png',
                })
            } catch (e) {
                console.error(e)
                await sock.sendMessage(from, { text: '❌ Erro ao remover fundo.' })
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