import { HttpStatus, Injectable } from '@nestjs/common';
import * as dynamoose from 'dynamoose';
import { Model } from 'dynamoose/dist/Model';
import * as Sentry from '@sentry/nestjs';
import axios from 'axios';
import { GraphqlService } from '../../../graphql/graphql.service';
import { convertToCamelCase } from '../../../utils/helpers/convertCamelCase';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { User } from '../entities/user.entity';
import { UserSchema } from '../entities/user.schema';
import { adjustValue } from 'src/utils/helpers/generalAdjustValue';
import { calcularTotalCostoWalletGuru } from 'src/utils/helpers/calcularCostoWalletGuru';
import { ClearPayments } from '../entities/clear-payments.entity';
import { ClearPaymentsSchema } from '../entities/clear-payments.schema';
import { RefundsEntity } from '../entities/refunds.entity';
import { RefundsSchema } from '../entities/refunds.schema';
import { ConfirmClearPaymentDto } from '../dto/confirm-clear-payment.dto';
import {
	validatePermisionssSp,
} from '../../../utils/helpers/getAccessServiceProviders';
import { buildFilterExpression } from 'src/utils/helpers/buildFilterExpressionDynamo';

@Injectable()
export class WalletService {
	private dbUserInstance: Model<User>;
	private dbClearPayments: Model<ClearPayments>;
	private dbRefunds: Model<RefundsEntity>;
	private readonly AUTH_MICRO_URL: string;

	constructor(
		private readonly graphqlService: GraphqlService,
	) {
		this.dbUserInstance = dynamoose.model<User>('Users', UserSchema);
		this.dbClearPayments = dynamoose.model<ClearPayments>(
			'ClearPayments',
			ClearPaymentsSchema
		);
		this.dbRefunds = dynamoose.model<RefundsEntity>('Refunds', RefundsSchema);
		this.AUTH_MICRO_URL = process.env.AUTH_URL;
	}

// cron functions

paginatedResults(page, itemsPerPage, results) {
	const offset = (page - 1) * itemsPerPage;
	const total = results.length;
	const totalPages = Math.ceil(total / itemsPerPage);
	const paginatedTransactions = results.slice(
		offset,
		offset + Number(itemsPerPage)
	);

	return convertToCamelCase({
		transactions: paginatedTransactions,
		currentPage: page,
		total,
		totalPages,
	});
}

async getWalletByProviderId(providerId: string) {
	const docClient = new DocumentClient();
	const params = {
		TableName: 'Providers',
		Key: { Id: providerId },
	};

	try {
		const result = await docClient.get(params).promise();
		return convertToCamelCase(result?.Item);
	} catch (error) {
		Sentry.captureException(error);
		return {
			statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
			customCode: 'WGE0137',
		};
	}
}


async getProviderInfoRevenueById(id: string) {
	const docClient = new DocumentClient();
	const params = {
		TableName: 'ClearPayments',
		Key: { Id: id },
	};

	try {
		const result = await docClient.get(params).promise();
		return convertToCamelCase(result?.Item);
	} catch (error) {
		Sentry.captureException(error);
		throw new Error(
			`Error fetching providerRevenues by id: ${error.message}`
		);
	}
}

async listClearPayments(filters, provider) {
	const docClient = new DocumentClient();

	const { page, items, month, year, providerId, ...filterRest } = filters;

	const pagedParsed = Number(filters?.page) || 1;
	const itemsParsed = Number(filters?.items) || 10;
	const expression = buildFilterExpression(filterRest);
	let clearPaymentsParamsWithService;
	if (providerId) {
		const clearPaymentsParams: DocumentClient.QueryInput = {
			TableName: 'ClearPayments',
			IndexName: 'ServiceProviderIdIndex',
			KeyConditionExpression: `ServiceProviderId  = :serviceProviderId`,

			...(expression.filterExpression && {
				FilterExpression: expression.filterExpression,
			}),
			...(Object.keys(expression.attributeNames).length && {
				ExpressionAttributeNames: expression.attributeNames,
			}),
			...(Object.keys(expression?.expressionValues).length && {
				ExpressionAttributeValues: {
					...expression?.expressionValues,
				},
			}),
		};
		const { ExpressionAttributeValues } = clearPaymentsParams;
		clearPaymentsParamsWithService = {
			...clearPaymentsParams,
			...(!ExpressionAttributeValues && {
				ExpressionAttributeValues: {
					':serviceProviderId': providerId,
				},
			}),
			...(Object.keys(ExpressionAttributeValues).length && {
				ExpressionAttributeValues: {
					...ExpressionAttributeValues,
					':serviceProviderId': providerId,
				},
			}),
		};
	} else {
		const clearPaymentsParams: DocumentClient.QueryInput = {
			TableName: 'ClearPayments',
			...(expression.filterExpression && {
				FilterExpression: expression.filterExpression,
			}),
			...(Object.keys(expression.attributeNames).length && {
				ExpressionAttributeNames: expression.attributeNames,
			}),
			...(Object.keys(expression?.expressionValues).length && {
				ExpressionAttributeValues: {
					...expression?.expressionValues,
				},
			}),
		};

		const { ExpressionAttributeValues } = clearPaymentsParams;
		if (ExpressionAttributeValues) {
			clearPaymentsParamsWithService = {
				...clearPaymentsParams,
				...(Object.keys(ExpressionAttributeValues).length && {
					ExpressionAttributeValues: {
						...ExpressionAttributeValues,
					},
				}),
			};
		} else {
			clearPaymentsParamsWithService = {
				...clearPaymentsParams,
				Select: 'ALL_ATTRIBUTES',
			};
		}
	}
	const clearPayments = await docClient
		.scan(clearPaymentsParamsWithService)
		.promise();
	let filteredClearPayments = convertToCamelCase(clearPayments?.Items);

	if (month) {
		filteredClearPayments = filteredClearPayments.filter(
			transaction => transaction.month == month
		);
	}
	if (year) {
		filteredClearPayments = filteredClearPayments.filter(
			transaction => transaction.year == year
		);
	}

	const paginatedResults = await this.paginatedResults(
		pagedParsed,
		itemsParsed,
		filteredClearPayments
	);

	const { transactions, ...paginated } = paginatedResults;

	const clearPaymentsTransformed = transactions.map(transaction => {
		return {
			...transaction,
			provider: provider?.name,
		};
	});
	const results = {
		clearPayments: clearPaymentsTransformed,
		...paginated,
	};

	return convertToCamelCase(results);
}


async getWalletByAddress(walletAddress: string) {
	const docClient = new DocumentClient();
	const params = {
		TableName: 'Wallets',
		IndexName: 'WalletAddressIndex',
		KeyConditionExpression: `WalletAddress  = :walletAddress`,
		ExpressionAttributeValues: {
			':walletAddress': walletAddress,
		},
	};

	try {
		const result = await docClient.query(params).promise();
		return convertToCamelCase(result.Items?.[0]);
	} catch (error) {
		Sentry.captureException(error);
		throw new Error(`Error fetching wallet by address: ${error.message}`);
	}
}


async getUserWithToken(token: string) {
	let userInfo = await axios.get(
		this.AUTH_MICRO_URL + '/api/v1/users/current-user',
		{ headers: { Authorization: token } }
	);
	userInfo = userInfo.data;
	const userByUserId = await this.dbUserInstance
		.scan('Id')
		.eq(userInfo.data.id)
		.exec();
	return userByUserId[0];
}


async batchUpdateTransactions(transactionIds: string[]) {
	const docClient = new DocumentClient();

	try {
		Promise.all(
			transactionIds.map(async transactionId => {
				const transactionParam = {
					Key: {
						Id: transactionId,
					},
					TableName: 'Transactions',
					UpdateExpression: 'SET Pay = :pay',
					ExpressionAttributeValues: {
						':pay': true,
					},
					ReturnValues: 'ALL_NEW',
				};
				await docClient.update(transactionParam).promise();
			})
		);
	} catch (error) {
		Sentry.captureException(error);
		return {
			statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
			customCode: 'WGE0236',
		};
	}
}


async getProviderById(providerId: string) {
	const docClient = new DocumentClient();
	const params = {
		TableName: 'Providers',
		Key: { Id: providerId },
	};

	try {
		const result = await docClient.get(params).promise();
		return convertToCamelCase(result?.Item);
	} catch (error) {
		Sentry.captureException(error);
		throw new Error(`Error fetching user by userId: ${error.message}`);
	}
}


async getUserInfoById(userId: string) {
	const docClient = new DocumentClient();
	const params = {
		TableName: 'Users',
		Key: { Id: userId },
	};

	try {
		const result = await docClient.get(params).promise();
		return convertToCamelCase(result?.Item);
	} catch (error) {
		Sentry.captureException(error);
		throw new Error(`Error fetching user by userId: ${error.message}`);
	}
}

async getRefunds(
	serviceProviderId: string,
	page: string,
	items: string,
	startDate: string,
	endDate: string,
	walletAddress: string,
	token: string,
	validateToken = true
) {
	// VALIDATE PERMISSION BY ROL MODULE
	if (validateToken) {
		const userWg = await this.getUserWithToken(token);
		const docClient = new DocumentClient();
		const params = {
			TableName: 'Roles',
			Key: { Id: userWg.RoleId },
		};
		const resultRol = await docClient.get(params).promise();
		const role = resultRol.Item;
		let permissions;
		if (userWg.Type === 'PROVIDER') {
			permissions = validatePermisionssSp({
				role,
				requestedModuleId: 'RFSP',
				requiredMethod: 'GET',
				userId: userWg.Id,
				serviceProviderId: userWg.ServiceProviderId,
			});
			if (permissions.hasAccess !== true) {
				return {
					statusCode: HttpStatus.FORBIDDEN,
					customCode: 'WGE0038',
				};
			}
		} else if (userWg.Type === 'PLATFORM') {
			// permissions = validatePermissionsPl({
			// 	role,
			// 	requestedModuleId: 'DWG2',
			// 	requiredMethod: 'POST',
			// 	userId: userWg.Id,
			// 	serviceProviderId: getWalletProvider.providerId,
			// });
		}
	}
	const pageNumber = parseInt(page, 10) || 1;
	const itemsNumber = parseInt(items, 10) || 10;

	const startTimestamp = startDate ? new Date(startDate).getTime() : null;
	const endTimestamp = endDate ? new Date(endDate).getTime() : null;

	let scan = this.dbRefunds.scan();

	if (serviceProviderId) {
		scan = scan.where('ServiceProviderId').eq(serviceProviderId);
	}

	if (walletAddress) {
		scan = scan.where('WalletAddress').eq(walletAddress);
	}

	if (startTimestamp !== null && endTimestamp !== null) {
		scan = scan.filter('CreateDate').between(startTimestamp, endTimestamp);
	} else if (startTimestamp !== null) {
		scan = scan.filter('CreateDate').ge(startTimestamp);
	} else if (endTimestamp !== null) {
		scan = scan.filter('CreateDate').le(endTimestamp);
	}

	const refundsData = await scan.exec();

	const convertedRefunds = convertToCamelCase(refundsData);

	await Promise.all(
		convertedRefunds.map(async refund => {
			const getWalletProvider = await this.getWalletAddressByProviderId(
				refund.serviceProviderId
			);
			const serviceProvider = await this.getProviderById(
				refund.serviceProviderId
			);
			const getWalletuser = await this.getWalletByAddress(
				refund.walletAddress
			);
			const dataUser = await this.getUserInfoById(getWalletuser.userId);
			refund.userName = dataUser.firstName + ' ' + dataUser.lastName;
			refund.walletServiceProvider = getWalletProvider.walletAddress;
			refund.nameServiceProvider = serviceProvider.name;
			// return refund;
		})
	);

	if (!convertedRefunds.length) {
		return {
			items: [],
			totalItems: 0,
			currentPage: pageNumber,
			totalPages: 0,
		};
	}

	const startIndex = (pageNumber - 1) * itemsNumber;
	const endIndex = Math.min(
		startIndex + itemsNumber,
		convertedRefunds.length
	);

	const paginatedRefunds = convertedRefunds.slice(startIndex, endIndex);

	return {
		items: paginatedRefunds,
		totalItems: convertedRefunds.length,
		currentPage: pageNumber,
		totalPages: Math.ceil(convertedRefunds.length / itemsNumber),
	};
}

async getPaymentsParameters(serviceProviderId: string): Promise<any> {
	const docClient = new DocumentClient();

	const params: DocumentClient.ScanInput = {
		TableName: 'PaymentParameters',
		IndexName: 'ServiceProviderIdIndex',
		FilterExpression: 'ServiceProviderId = :serviceProviderId',
		ExpressionAttributeValues: {
			':serviceProviderId': serviceProviderId,
		},
	};

	try {
		const result = await docClient.scan(params).promise();
		const paymentParameters = convertToCamelCase(result.Items || []);
		return paymentParameters;
	} catch (error) {
		Sentry.captureException(error);
	}
}


async getWalletAddressByProviderId(providerId: string) {
	const docClient = new DocumentClient();
	const params = {
		TableName: 'Wallets',
		IndexName: 'ProviderIdIndex',
		KeyConditionExpression: `ProviderId  = :providerId`,
		ExpressionAttributeValues: {
			':providerId': providerId,
		},
	};

	try {
		const result = await docClient.query(params).promise();
		return convertToCamelCase(result.Items?.[0]);
	} catch (error) {
		Sentry.captureException(error);
		return {};
	}
}

	async getProviders(): Promise<any> {
		const docClient = new DocumentClient();

		const params: DocumentClient.ScanInput = {
			TableName: 'Providers',
			FilterExpression: '#active = :active',
			ExpressionAttributeNames: {
				'#active': 'Active',
			},
			ExpressionAttributeValues: {
				':active': true,
			},
		};

		try {
			const result = await docClient.scan(params).promise();
			const providers = convertToCamelCase(result.Items || []);
			return providers;
		} catch (error) {
			Sentry.captureException(error);
		}
	}


	async getProviderCompletedTransactions(
		receiverUrl: string,
		startDate,
		endDate
	) {
		const docClient = new DocumentClient();
		const params = {
			TableName: 'Transactions',
			IndexName: 'ReceiverUrlIndex',
			KeyConditionExpression: `ReceiverUrl  = :receiverUrl`,
			FilterExpression: `
			 #state = :state AND
			 #pay = :pay AND
			 #transactionDate BETWEEN :start AND :end AND
			 #type = :type
			 `,
			ExpressionAttributeNames: {
				'#state': 'State',
				'#pay': 'Pay',
				'#transactionDate': 'createdAt',
				'#type': 'Type',
			},
			ExpressionAttributeValues: {
				':state': 'COMPLETED',
				':pay': false,
				':receiverUrl': receiverUrl,
				':start': startDate,
				':end': endDate,
				':type': 'OutgoingPayment',
			},
		};

		try {
			const result = await docClient.query(params).promise();
			return convertToCamelCase(result.Items);
		} catch (error) {
			Sentry.captureException(error);
			throw new Error(`Error fetching provider transactions: ${error.message}`);
		}
	}

	async generateClearPayments() {
		console.log('Generate Clear Payments');
		try {
			const providers = await this.getProviders();
			const now = new Date();

			const startDate = new Date(
				now.getFullYear(),
				now.getMonth() - 1,
				1,
				0,
				0,
				0,
				0
			);

			const endDate = new Date(
				now.getFullYear(),
				now.getMonth(),
				0,
				23,
				59,
				59,
				999
			);
			Promise.all(
				providers.map(async provider => {
					const providerWallet = await this.getWalletAddressByProviderId(
						provider?.id
					);

					const transactions = await this.getProviderCompletedTransactions(
						providerWallet?.walletAddress,
						startDate.getTime(),
						endDate.getTime()
					);

					if (transactions?.length) {
						const paymentParameters = await this.getPaymentsParameters(
							provider?.id
						);

						const transactionIds = transactions?.map(transaction => {
							return transaction?.id;
						});

						const totalAmount = transactions.reduce((total, transaction) => {
							return total + parseFloat(transaction?.receiveAmount?.value || 0);
						}, 0);

						const walletInfo = await this.graphqlService.listWalletInfo(
							providerWallet.rafikiId
						);
						const scale = walletInfo.data.walletAddress.asset.scale;
						const code = walletInfo.data.walletAddress.asset.code;
						const paymentParameter =
							paymentParameters?.find(parameter => parameter?.asset === code) ||
							paymentParameters?.[0];
						const fees = adjustValue(
							calcularTotalCostoWalletGuru(
								paymentParameter?.base,
								paymentParameter?.comision,
								paymentParameter?.cost,
								paymentParameter?.percent,
								scale
							),
							scale
						);

						const getRefunds = await this.getRefunds(
							provider?.id,
							'1',
							'100000',
							`${
								startDate.getMonth() + 1
							}/${startDate.getDate()}/${startDate.getFullYear()}`,
							`${
								endDate.getMonth() + 1
							}/${endDate.getDate()}/${endDate.getFullYear()}`,
							'',
							'',
							false
						);
						let refunds = 0;
						getRefunds.items.map(async refund => {
							refunds += refund.amount;
						});

						const createProviderRevenueDTO = {
							ServiceProviderId: provider?.id,
							Value: totalAmount,
							StartDate: startDate.getTime(),
							EndDate: endDate.getTime(),
							Fees: fees * transactions?.length,
							TransactionIds: transactionIds,
							Month: startDate.getMonth() + 1,
							Year: startDate.getFullYear(),
							Refunds: refunds,
						};
						await this.dbClearPayments.create(createProviderRevenueDTO);
					}
				})
			);
			console.log('Clear Payments Generated');
		} catch (error) {
			Sentry.captureException(error);
		}
	}

	async confirmClearPayment(
		confirmClearPayment: ConfirmClearPaymentDto,
		clearPayment
	) {
		try {
			await this.batchUpdateTransactions(clearPayment?.transactionIds);

			const docClient = new DocumentClient();

			const clearPaymentParams = {
				TableName: 'ClearPayments',
				Key: {
					Id: clearPayment?.id,
				},
				UpdateExpression:
					'SET #referenceNumber= :referenceNumber, #observation= :observation, #state= :state',
				ExpressionAttributeNames: {
					'#referenceNumber': 'ReferenceNumber',
					'#observation': 'Observations',
					'#state': 'State',
				},
				ExpressionAttributeValues: {
					':referenceNumber': confirmClearPayment.referenceNumber,
					':observation': confirmClearPayment.observations,
					':state': true,
				},
				ReturnValues: 'ALL_NEW',
			};

			const confirmedClearPayment = await docClient
				.update(clearPaymentParams)
				.promise();
			return convertToCamelCase(confirmedClearPayment?.Attributes);
		} catch (error) {
			Sentry.captureException(error);
			throw new Error(error.message);
		}
	}
}
