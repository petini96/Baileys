import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import readline from 'readline'
import makeWASocket, { AnyMessageContent, delay, DisconnectReason, fetchLatestBaileysVersion, getAggregateVotesInPollMessage, makeCacheableSignalKeyStore, makeInMemoryStore, PHONENUMBER_MCC, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey, WAMessage } from '../src'
import MAIN_LOGGER from '../src/Utils/logger'
import open from 'open'
import fs from 'fs'

import {UserNotifier} from '../src/Types/UserNotifier';
import { randomUUID } from 'crypto'

const userNotifiers: UserNotifier[] = [
    {
		id: randomUUID(),
        name: "Vinícius",
        number: "556784087417",
        acceptWhatsappContact: true,
        hasBeenNotified: false
    },
    {
		id: randomUUID(),
        name: "Bolerada67",
        number: "556791315938",
        acceptWhatsappContact: true,
        hasBeenNotified: false
    },
	{
		id: randomUUID(),
        name: "Sasá",
        number: "556791388353",
        acceptWhatsappContact: false,
        hasBeenNotified: false
    },
	{
		id: randomUUID(),
        name: "Ezidio",
        number: "556781518567",
        acceptWhatsappContact: false,
        hasBeenNotified: false
    }
];

 
const logger = MAIN_LOGGER.child({})
logger.level = 'trace'

const useStore = !process.argv.includes('--no-store')
const doReplies = !process.argv.includes('--no-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')
const useMobile = process.argv.includes('--mobile')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

// Read line interface
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('./baileys_store_multi.json')
// save every 10s
setInterval(() => {
	store?.writeToFile('./baileys_store_multi.json')
}, 10_000)

// start a connection
const startSocketServer = async () => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		printQRInTerminal: !usePairingCode,
		mobile: useMobile,
		auth: {
			creds: state.creds,
			/** caching makes the store faster to send/recv messages */
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		msgRetryCounterCache,
		generateHighQualityLinkPreview: true,
		// ignore all broadcast messages -- to receive the same
		// comment the line below out
		// shouldIgnoreJid: jid => isJidBroadcast(jid),
		// implement to handle retries & poll updates
		getMessage,
	})

	store?.bind(sock.ev)

	console.log("Jesus cristinho");
	// Pairing code for Web clients
	if(usePairingCode && !sock.authState.creds.registered) {
		if(useMobile) {
			throw new Error('Cannot use pairing code with mobile api')
		}

		const phoneNumber = await question('Please enter your mobile phone number:\n')
		const code = await sock.requestPairingCode(phoneNumber)
		console.log(`Pairing code: ${code}`)
	}

	// If mobile was chosen, ask for the code
	if(useMobile && !sock.authState.creds.registered) {
		const { registration } = sock.authState.creds || { registration: {} }

		if(!registration.phoneNumber) {
			registration.phoneNumber = await question('Please enter your mobile phone number:\n')
		}

		const libPhonenumber = await import("libphonenumber-js")
		const phoneNumber = libPhonenumber.parsePhoneNumber(registration!.phoneNumber)
		if(!phoneNumber?.isValid()) {
			throw new Error('Invalid phone number: ' + registration!.phoneNumber)
		}

		registration.phoneNumber = phoneNumber.format('E.164')
		registration.phoneNumberCountryCode = phoneNumber.countryCallingCode
		registration.phoneNumberNationalNumber = phoneNumber.nationalNumber
		const mcc = PHONENUMBER_MCC[phoneNumber.countryCallingCode]
		if(!mcc) {
			throw new Error('Could not find MCC for phone number: ' + registration!.phoneNumber + '\nPlease specify the MCC manually.')
		}

		registration.phoneNumberMobileCountryCode = mcc

		async function enterCode() {
			try {
				const code = await question('Please enter the one time code:\n')
				const response = await sock.register(code.replace(/["']/g, '').trim().toLowerCase())
				console.log('Successfully registered your phone number.')
				console.log(response)
				rl.close()
			} catch(error) {
				console.error('Failed to register your phone number. Please try again.\n', error)
				await askForOTP()
			}
		}

		async function enterCaptcha() {
			const response = await sock.requestRegistrationCode({ ...registration, method: 'captcha' })
			const path = __dirname + '/captcha.png'
			fs.writeFileSync(path, Buffer.from(response.image_blob!, 'base64'))

			open(path)
			const code = await question('Please enter the captcha code:\n')
			fs.unlinkSync(path)
			registration.captcha = code.replace(/["']/g, '').trim().toLowerCase()
		}

		async function askForOTP() {
			if (!registration.method) {
				let code = await question('How would you like to receive the one time code for registration? "sms" or "voice"\n')
				code = code.replace(/["']/g, '').trim().toLowerCase()
				if(code !== 'sms' && code !== 'voice') {
					return await askForOTP()
				}

				registration.method = code
			}

			try {
				await sock.requestRegistrationCode(registration)
				await enterCode()
			} catch(error) {
				console.error('Failed to request registration code. Please try again.\n', error)

				if(error?.reason === 'code_checkpoint') {
					await enterCaptcha()
				}

				await askForOTP()
			}
		}

		askForOTP()
	}

	const sendMessageWTyping = async(msg: AnyMessageContent, jid: string) => {
		await sock.presenceSubscribe(jid)
		await delay(500)

		await sock.sendPresenceUpdate('composing', jid)
		await delay(2000)

		await sock.sendPresenceUpdate('paused', jid)

		await sock.sendMessage(jid, msg)
	}

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	
	let boasVindasEnviada = false;

	sock.ev.process(
		
		// events is a map for event name => event data
		async(events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if(connection === 'close') {
					// reconnect if not logged out
					if((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSocketServer()
					} else {
						console.log('Connection closed. You are logged out.')
					}
				}

				console.log('connection update', update)
			}

			// credentials updated -- save them
			if(events['creds.update']) {
				await saveCreds()
			}

			if(events['labels.association']) {
				console.log(events['labels.association'])
			}


			if(events['labels.edit']) {
				console.log(events['labels.edit'])
			}

			if(events.call) {
				console.log('recv call event', events.call)
			}

			// history received
			if(events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest } = events['messaging-history.set']
				console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest})`)
			}

			// received a new message
			if(events['messages.upsert']) {
				
				const upsert = events['messages.upsert']
				console.log('recv messages ', JSON.stringify(upsert, undefined, 2))
				console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>.",upsert.type)
				if(upsert.type === 'notify') {
					for(const msg of upsert.messages) {
						if(!msg.key.fromMe && doReplies) {
							
							const messageString = JSON.stringify(msg, undefined, 2)
                			console.log('Mensagem como string:', messageString)
							console.log('replying to', msg.key.remoteJid)
							await sock!.readMessages([msg.key])
							await enviarMensagemCadastro(userNotifiers[1], msg)
							

							// console.log('Hello there!',msg.key.remoteJid)
							// const id = '556791315938@s.whatsapp.net' // the WhatsApp ID 
							 
							// console.log("here->", mensagemRecebida);
							// if (!boasVindasEnviada) {
							// 	await sock.sendMessage(id, { text: 'Olá, seja vem vindo ao MS-Qualifica Digital!' })
							// 	await sock.sendMessage(id, { text: 'Você deseja receber notícias do MS-Qualifica Digital ?\n\n' })
							// 	await sock.sendMessage(id, { text: '1) SIM' })
							// 	await sock.sendMessage(id, { text: '2) NÃO' })
							// 	boasVindasEnviada = true;
							// } else {
							// 	if (mensagemRecebida) {
							// 		switch (mensagemRecebida){
							// 			case "1" || "sim" || "ok" || "aceito" || "tudo bem" || "yes":
							// 				await sock.sendMessage(id, { text: 'Que bom! Vamos te manter atualizado sobre as novidades. Até mais."' }, { quoted: msg })
							// 				break;	
							// 			case "2" || "nao" || "no" || "nunca" || "never" || "obrigado":
							// 				await sock.sendMessage(id, { text: 'Tudo bem. Caso queira receber novamente é só digitar "receber noticias"' }, { quoted: msg })
							// 				break;
							// 			case "voltar" || "voltar a ver notícia" || "receber noticia":
							// 				await sock.sendMessage(id, { text: 'Voltaremos a enviar as notificações! Obrigado."' }, { quoted: msg })
							// 				break;
							// 		}
	
							// 	}
							// }
							// const sentMsg3  = await sock.sendMessage(id, { text: 'Faça o seu cadastro: https://msqualificadigital.com.br/homolog/login' })
						}
					}
				}
			}

			// messages updated like status delivered, message deleted etc.
			if(events['messages.update']) {
				console.log(
					JSON.stringify(events['messages.update'], undefined, 2)
				)

				for(const { key, update } of events['messages.update']) {
					if(update.pollUpdates) {
						const pollCreation = await getMessage(key)
						if(pollCreation) {
							console.log(
								'got poll update, aggregation: ',
								getAggregateVotesInPollMessage({
									message: pollCreation,
									pollUpdates: update.pollUpdates,
								})
							)
						}
					}
				}
			}

			if(events['message-receipt.update']) {
				console.log(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				console.log(events['messages.reaction'])
			}

			if(events['presence.update']) {
				console.log(events['presence.update'])
			}

			if(events['chats.update']) {
				console.log(events['chats.update'])
			}

			if(events['contacts.update']) {
				for(const contact of events['contacts.update']) {
					if(typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						console.log(
							`contact ${contact.id} has a new profile pic: ${newUrl}`,
						)
					}
				}
			}

			if(events['chats.delete']) {
				console.log('chats deleted ', events['chats.delete'])
			}
		}
	)

	return sock

	async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
		if(store) {
			const msg = await store.loadMessage(key.remoteJid!, key.id!)
			return msg?.message || undefined
		}

		// only if store is present
		return proto.Message.fromObject({})
	}

	async function enviarMensagens(userNotifiers: UserNotifier[]) {
		for (const user of userNotifiers) {

			if(user.acceptWhatsappContact){
				if(!user.hasBeenNotified){
					const mensagem = 'Olá, esta é uma mensagem de exemplo enviada pelo WhatsApp!';
					const idContato = user.number + '@s.whatsapp.net';
					try {
						await sock.sendMessage(idContato, { text: mensagem });
						console.log(`Mensagem enviada para ${user.name} (${idContato})`);
					} catch (error) {
						console.error(`Erro ao enviar mensagem para ${user.name} (${idContato}):`, error);
					}
					user.hasBeenNotified = true;
				}else{
					console.log("USUÁRIO "+user.name+" JÁ FOI NOTIFICADO")
				}
			}else{
				console.log("CANDIDATO NÃO ACEITA CONTATO POR WHATSAPP")
			}
			
		}
	}
	
	async function aceitaContinuarRecebendoNotificacaoWhatsapp(userNotifier: UserNotifier, msg: WAMessage ) {
		if(userNotifier.acceptWhatsappContact){
			if(!userNotifier.hasBeenNotified){
				const idContato = userNotifier.number + '@s.whatsapp.net';
				try {
					await sock.sendMessage(idContato, { text: 'Deseja continuar recebendo este tipo de mensagem?' })
					await sock.sendMessage(idContato, { text: '1) SIM' })
					await sock.sendMessage(idContato, { text: '2) NÃO' })

					const mensagemRecebida = msg.message?.conversation

					if (mensagemRecebida) {
						switch (mensagemRecebida){
							case "1" || "sim" || "ok" || "aceito" || "tudo bem" || "yes":
								await sock.sendMessage(idContato, { text: ' Perfeito! Manteremos você sempre atualizado sobre suas vagas"' }, { quoted: msg })
								break;	
							case "2" || "nao" || "no" || "nunca" || "never" || "obrigado":
								await sock.sendMessage(idContato, { text: 'Que pena! Caso queira receber nossas mensagens novamente, acesse o portal e atualize o seu cadastro.' }, { quoted: msg })
								break;
							case "voltar" || "voltar a ver notícia" || "receber noticia":
								await sock.sendMessage(idContato, { text: 'Voltaremos a enviar as notificações! Obrigado."' }, { quoted: msg })
								break;
						}
					}
				} catch (error) {
					console.error(`Erro ao enviar mensagem para ${userNotifier.name} (${idContato}):`, error);
				}
				userNotifier.hasBeenNotified = true;
			}else{
				console.log("USUÁRIO "+userNotifier.name+" JÁ FOI NOTIFICADO")
			}
		}else{
			console.log("CANDIDATO NÃO ACEITA CONTATO POR WHATSAPP")
		}
	}

	async function enviarMensagemCadastro(userNotifier: UserNotifier, msg: WAMessage ) {
		if(userNotifier.acceptWhatsappContact){
			if(!userNotifier.hasBeenNotified){
				const idContato = userNotifier.number + '@s.whatsapp.net';
				try {
					await sock.sendMessage(idContato, {text: 'Seu cadastro foi realizado com sucesso.'})
					await sock.sendMessage(idContato, {text: 'O MS Qualifica Digital é uma iniciativa do Governo de Mato Grosso do Sul que facilita o contato entre empregadores e candidatos.'})
					await sock.sendMessage(idContato, {text: 'De cursos de capacitação para candidatos a microcrédito para empresas, nosso objetivo é impulsionar a economia do Mato Grosso do Sul gerando novas oportunidades.'})
					await sock.sendMessage(idContato, {text: 'Mantenha seus dados atualizados e fique atento as novidades. Em breve, muitas funcionalidades estarão disponíveis em nosso portal. Para acessá-lo clique no botão abaixo ou pelo site https://www.msqualificadigital.com.br/homolog'})
					
					//const mensagemRecebida = msg.message?.conversation
					await aceitaContinuarRecebendoNotificacaoWhatsapp(userNotifiers[1],msg)
					console.log(`Mensagem enviada para ${userNotifier.name} (${idContato})`);
				} catch (error) {
					console.error(`Erro ao enviar mensagem para ${userNotifier.name} (${idContato}):`, error);
				}
				userNotifier.hasBeenNotified = true;
			}else{
				console.log("USUÁRIO "+userNotifier.name+" JÁ FOI NOTIFICADO")
			}
		}else{
			console.log("CANDIDATO NÃO ACEITA CONTATO POR WHATSAPP")
		}
	}
	
}

 
//  startSock();
export default startSocketServer;