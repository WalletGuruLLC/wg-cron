import {
	Injectable,
	NestMiddleware,
	HttpException,
	HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { errorCodes } from 'src/utils/constants';

@Injectable()
export class AccessControlMiddleware implements NestMiddleware {
	private readonly authUrl: string;

	constructor(private configService: ConfigService) {
		this.authUrl = this.configService.get<string>('AUTH_URL');
	}

	async use(req: Request, res: Response, next: NextFunction): Promise<void> {
		const authHeader = req.headers.authorization;

		if (!authHeader) {
			throw new HttpException(
				{
					statusCode: HttpStatus.UNAUTHORIZED,
					customCode: 'WGE0021',
					customMessage: errorCodes.WGE0021?.description,
					customMessageEs: errorCodes.WGE0021?.descriptionEs,
				},
				HttpStatus.UNAUTHORIZED
			);
		}

		const body = {
			path: '/api/v1/wallets',
			method: req.method,
		};

		try {
			await axios.post(this.authUrl + '/api/v1/users/validate-access', body, {
				headers: {
					Authorization: authHeader,
				},
			});
			next();
		} catch (error) {
			const errorMessage = error.response?.data || error.message;
			throw new HttpException(errorMessage, HttpStatus.UNAUTHORIZED);
		}
	}
}
