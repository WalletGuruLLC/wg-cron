import {
	Module,
	MiddlewareConsumer,
	NestModule,
} from '@nestjs/common';
import { WalletService } from './service/wallet.service';
import { ConfigModule } from '@nestjs/config';
import { VerifyService } from '../../verify/verify.service';
import { VerifyModule } from '../../verify/verify.module';
import { AccessControlMiddleware } from '../../verify/access-level-control';

import { ApolloClientService } from 'src/graphql/apollo-client.service';
import { GraphqlService } from 'src/graphql/graphql.service';
import { ClearPaymentController } from './controller/clear-payment.controller';

@Module({
	imports: [ConfigModule, VerifyModule],
	controllers: [
		ClearPaymentController,
	],
	providers: [
		WalletService,
		VerifyService,
		ApolloClientService,
		GraphqlService,
	],
	exports: [WalletService],
})
export class WalletModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer
			.apply(AccessControlMiddleware)
	}
}
