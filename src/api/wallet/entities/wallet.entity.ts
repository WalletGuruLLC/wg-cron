import { Document } from 'dynamoose/dist/Document';

export class Wallet extends Document {
	Id = '';
	Name = '';
	WalletType = '';
	WalletAddress = '';
	RafikiId?: string;
	UserId?: string;
	ProviderId?: string;
	Active = true;
	PrivateKey?: string;
	PublicKey?: string;
	KeyId?: string;
	CreateDate?: string;
	UpdateDate?: string;
	PostedCredits?: number;
	PostedDebits?: number;
	PendingCredits?: number;
	PendingDebits?: number;
}
