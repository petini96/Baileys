import { Contact } from './Contact'

export type WAConnectionState = 'open' | 'connecting' | 'close'

export type UserNotifier = {
	id?:  string
	name: string
	number: string
	acceptWhatsappContact: boolean
	hasBeenNotified: boolean
}