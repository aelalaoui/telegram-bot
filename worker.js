/**
 * Telegram Solana Wallet Monitor Bot
 *
 * This bot monitors Solana wallet transactions using Helius API webhooks.
 * It allows users to add wallet addresses to monitor and receives real-time
 * transaction notifications via Telegram.
 */

// Webhook endpoint where Telegram will send updates
const WEBHOOK_ENDPOINT = '/webhook';

// Webhook endpoint for Helius transaction notifications
const HELIUS_WEBHOOK_ENDPOINT = '/helius-webhook';  // ← Corrigé pour éviter la boucle

// Base URL for Helius API
const HELIUS_API = 'https://api.helius.xyz/v0';

// Solana explorer base URL
const SOLSCAN_BASE = 'https://solscan.io';

/**
 * Main export for Cloudflare Worker (ES Modules syntax)
 */
export default {
    async fetch(request, env, ctx) {
        // Vérifiez que les tokens existent
        if (!env.TELEGRAM_BOT_TOKEN) {
            return new Response('TELEGRAM_BOT_TOKEN not configured', { status: 500 });
        }
        if (!env.HELIUS_API_KEY) {
            return new Response('HELIUS_API_KEY not configured', { status: 500 });
        }

        try {
            const url = new URL(request.url);
            const path = url.pathname;
            const method = request.method;
            const workerUrl = `${url.protocol}//${url.host}`;

            console.log('Incoming request:', { path, method });

            if (method === 'POST' && path === WEBHOOK_ENDPOINT) {
                const update = await request.json();
                console.log('Received Telegram update:', JSON.stringify(update));
                ctx.waitUntil(handleTelegramUpdate(update, env));
                return new Response('OK', { status: 200 });
            } else if (method === 'POST' && path === HELIUS_WEBHOOK_ENDPOINT) {
                const transactions = await request.json();
                console.log('Received Helius webhook:', JSON.stringify(transactions));
                ctx.waitUntil(handleHeliusWebhook(transactions, env));
                return new Response('OK', { status: 200 });
            } else if (method === 'GET' && path === '/setwebhook') {
                return await setTelegramWebhook(encodeURIComponent(`${workerUrl}${WEBHOOK_ENDPOINT}`), env);
            } else {
                return new Response('Not Found', { status: 404 });
            }
        } catch (error) {
            console.error('Request handling error:', error);
            return new Response('Internal Server Error', { status: 500 });
        }
    }
};

/**
 * Sets up the Telegram webhook URL
 * This needs to be called once to tell Telegram where to send updates
 * 
 * @param {string} url - URL-encoded webhook endpoint
 * @param {Object} env - Environment variables
 * @returns {Response} Setup result
 */
async function setTelegramWebhook(url, env) {
    try {
        const webhookUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${url}`;
        console.log('Setting webhook URL:', webhookUrl);
        const response = await fetch(webhookUrl);
        const result = await response.json();
        console.log('Webhook setup response:', result);

        if (response.ok) {
            return new Response('Webhook set successfully!', { status: 200 });
        } else {
            return new Response(`Failed to set webhook: ${result.description}`, { status: response.status });
        }
    } catch (error) {
        console.error('Webhook setup error:', error);
        return new Response('Failed to set webhook', { status: 500 });
    }
}

/**
 * Handles incoming Telegram updates and routes different commands
 * Available commands:
 * - /start, /help: Show help message
 * - /addwallet <address>: Add a wallet address to monitor
 * - /removewallet <address>: Remove a wallet address from monitoring
 * - /mywallets: List monitored wallet addresses
 *
 * @param {Object} update - Telegram update object
 * @param {Object} env - Environment variables
 */
async function handleTelegramUpdate(update, env) {
    if (!update.message || !update.message.text) {
        console.log('Invalid update received:', update);
        return;
    }

    const chatId = update.message.chat.id;
    const text = update.message.text.toLowerCase();
    console.log('Processing message:', { chatId, text });

    try {
        if (text === '/start' || text === '/help') {
            await sendMessage(chatId,
                'Welcome to the Solana Wallet Monitor Bot\\! 🚀\n\n' +
                'Available commands:\n' +
                '/addwallet \\<address\\> \\- Add a wallet address to monitor\n' +
                '/removewallet \\<address\\> \\- Remove a wallet address from monitoring\n' +
                '/mywallets \\- List monitored wallet addresses\n' +
                '/help \\- Show this help message',
                env
            );
        } else if (text.startsWith('/addwallet ')) {
            const address = text.split(' ')[1];
            await handleAddWalletCommand(chatId, address, env);
        } else if (text.startsWith('/removewallet ')) {
            const address = text.split(' ')[1];
            await handleRemoveWalletCommand(chatId, address, env);
        } else if (text === '/mywallets') {
            await handleMyWalletsCommand(chatId, env);
        }
    } catch (error) {
        console.error('Error handling update:', error);
        await sendMessage(chatId, '❌ Sorry, an error occurred\\. Please try again later\\.', env);
    }
}

/**
 * Handles incoming webhooks from Helius API for transaction notifications
 * Following official Helius webhook structure: https://www.helius.dev/docs/data-streaming/quickstart
 *
 * @param {Array} transactions - Array of transaction data from Helius webhook
 * @param {Object} env - Environment variables
 */
async function handleHeliusWebhook(transactions, env) {
    console.log('Processing Helius webhook with transactions:', transactions.length);

    // Helius sends an array of transactions
    if (!Array.isArray(transactions)) {
        console.error('Invalid webhook payload: expected array of transactions');
        return;
    }

    // Process each transaction and notify relevant users
    for (const transaction of transactions) {
        try {
            // Validate transaction structure according to Helius docs
            if (!transaction.signature || !transaction.slot) {
                console.log('Skipping invalid transaction:', transaction);
                continue;
            }

            // Format the transaction message
            const message = formatTransactionMessage(transaction);

            // Get wallet addresses involved in this transaction
            const involvedAddresses = new Set();

            // Add fee payer (always present in Helius enhanced webhooks)
            if (transaction.feePayer) {
                involvedAddresses.add(transaction.feePayer);
            }

            // Add addresses from account keys (Helius enhanced format)
            if (transaction.accountData) {
                transaction.accountData.forEach(account => {
                    if (account.account) {
                        involvedAddresses.add(account.account);
                    }
                });
            }

            // Add addresses from token transfers (Helius enhanced format)
            if (transaction.tokenTransfers && Array.isArray(transaction.tokenTransfers)) {
                transaction.tokenTransfers.forEach(transfer => {
                    if (transfer.fromUserAccount) involvedAddresses.add(transfer.fromUserAccount);
                    if (transfer.toUserAccount) involvedAddresses.add(transfer.toUserAccount);
                });
            }

            // Add addresses from native transfers (Helius enhanced format)
            if (transaction.nativeTransfers && Array.isArray(transaction.nativeTransfers)) {
                transaction.nativeTransfers.forEach(transfer => {
                    if (transfer.fromUserAccount) involvedAddresses.add(transfer.fromUserAccount);
                    if (transfer.toUserAccount) involvedAddresses.add(transfer.toUserAccount);
                });
            }

            // Add addresses from instruction accounts (fallback for standard format)
            if (transaction.transaction && transaction.transaction.message && transaction.transaction.message.accountKeys) {
                transaction.transaction.message.accountKeys.forEach(key => {
                    if (typeof key === 'string') {
                        involvedAddresses.add(key);
                    } else if (key.pubkey) {
                        involvedAddresses.add(key.pubkey);
                    }
                });
            }

            // Notify users monitoring any of these addresses
            const notifiedUsers = new Set();
            let notificationCount = 0;

            for (const address of involvedAddresses) {
                const users = await getUsersForWallet(address, env);
                for (const userId of users) {
                    if (!notifiedUsers.has(userId)) {
                        notifiedUsers.add(userId);
                        try {
                            await sendMessage(userId, message, env);
                            notificationCount++;
                        } catch (error) {
                            console.error(`Failed to notify user ${userId}:`, error);
                        }
                    }
                }
            }

            console.log(`Transaction ${transaction.signature}: notified ${notificationCount} users, involved ${involvedAddresses.size} addresses`);

        } catch (error) {
            console.error('Error processing transaction:', error, 'Transaction:', transaction);
        }
    }
}

/**
 * Adds a wallet address to the user's watchlist
 *
 * @param {number} chatId - Telegram chat ID
 * @param {string} address - Wallet address to add
 * @param {Object} env - Environment variables
 */
async function handleAddWalletCommand(chatId, address, env) {
    try {
        // Validate the wallet address
        if (!address) {
            await sendMessage(chatId, '❌ Please provide a wallet address\\.\nExample: `/addwallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`', env);
            return;
        }

        if (!isValidSolanaAddress(address)) {
            await sendMessage(chatId, '❌ Invalid Solana wallet address format\\. Please check and try again\\.', env);
            return;
        }

        // Check if user already monitors this wallet
        const userWallets = await getUserWallets(chatId, env);
        const existingWallet = userWallets.find(w => w.address === address);
        if (existingWallet) {
            await sendMessage(chatId, `⚠️ You are already monitoring this wallet address\\.\n\`${escapeMarkdown(address)}\``, env);
            return;
        }

        // Check wallet limit (optional)
        if (userWallets.length >= 10) {
            await sendMessage(chatId, '❌ You have reached the maximum limit of 10 monitored wallets\\. Please remove some wallets first\\.', env);
            return;
        }

        await sendMessage(chatId, '�� Creating webhook for wallet monitoring\\.\\.\\. Please wait\\.', env);

        // Create Helius webhook
        const webhookResult = await createHeliusWebhook(address, env);

        // Store the wallet for the user
        await storeUserWallet(chatId, address, webhookResult.webhookID, env);

        // Store the wallet-to-user mapping for notifications
        await storeWalletToUserMapping(address, chatId, env);

        await sendMessage(chatId,
            `✅ *Wallet Successfully Added\\!*\n\n` +
            `Address: \`${escapeMarkdown(address)}\`\n` +
            `Webhook ID: \`${escapeMarkdown(webhookResult.webhookID)}\`\n\n` +
            `You will now receive notifications for all transactions involving this wallet\\.`,
            env
        );

    } catch (error) {
        console.error('Error adding wallet:', error);
        await sendMessage(chatId, '❌ Failed to add wallet\\. Please try again later\\.', env);
    }
}

/**
 * Removes a wallet address from the user's watchlist
 *
 * @param {number} chatId - Telegram chat ID
 * @param {string} address - Wallet address to remove
 * @param {Object} env - Environment variables
 */
async function handleRemoveWalletCommand(chatId, address, env) {
    try {
        if (!address) {
            await sendMessage(chatId, '❌ Please provide a wallet address to remove\\.\nExample: `/removewallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`', env);
            return;
        }

        await sendMessage(chatId, '🔄 Removing wallet from monitoring\\.\\.\\. Please wait\\.', env);

        const success = await removeUserWallet(chatId, address, env);

        if (success) {
            // Remove from wallet-to-user mapping
            const key = `wallet_users_${address}`;
            try {
                if (env.WALLET_STORAGE) {
                    const data = await env.WALLET_STORAGE.get(key);
                    if (data) {
                        const userList = JSON.parse(data);
                        const updatedList = userList.filter(id => id !== chatId);
                        if (updatedList.length > 0) {
                            await env.WALLET_STORAGE.put(key, JSON.stringify(updatedList));
                        } else {
                            await env.WALLET_STORAGE.delete(key);
                        }
                    }
                }
            } catch (error) {
                console.error('Error updating wallet-to-user mapping:', error);
            }

            await sendMessage(chatId,
                `✅ *Wallet Successfully Removed\\!*\n\n` +
                `Address: \`${escapeMarkdown(address)}\`\n\n` +
                `You will no longer receive notifications for this wallet\\.`,
                env
            );
        } else {
            await sendMessage(chatId, '❌ Wallet not found in your monitoring list\\.', env);
        }

    } catch (error) {
        console.error('Error removing wallet:', error);
        await sendMessage(chatId, '❌ Failed to remove wallet\\. Please try again later\\.', env);
    }
}

/**
 * Lists all wallet addresses monitored for the user
 *
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function handleMyWalletsCommand(chatId, env) {
    try {
        const userWallets = await getUserWallets(chatId, env);

        if (userWallets.length === 0) {
            await sendMessage(chatId,
                '📋 *Your Monitored Wallets*\n\n' +
                'You are not currently monitoring any wallets\\.\n\n' +
                'Use `/addwallet <address>` to start monitoring a wallet\\.',
                env
            );
            return;
        }

        let message = `📋 *Your Monitored Wallets \\(${userWallets.length}/10\\)*\n\n`;

        userWallets.forEach((wallet, index) => {
            const shortAddress = `${wallet.address.substring(0, 8)}\\.\\.\\.${wallet.address.substring(wallet.address.length - 8)}`;
            const addedDate = new Date(wallet.addedAt).toLocaleDateString();

            message += `${index + 1}\\. \`${escapeMarkdown(shortAddress)}\`\n`;
            message += `   Added: ${escapeMarkdown(addedDate)}\n`;
            message += `   [View on Solscan](${SOLSCAN_BASE}/account/${wallet.address})\n\n`;
        });

        message += 'Use `/removewallet <address>` to stop monitoring a wallet\\.';

        await sendMessage(chatId, message, env);

    } catch (error) {
        console.error('Error listing wallets:', error);
        await sendMessage(chatId, '❌ Failed to retrieve your wallet list\\. Please try again later\\.', env);
    }
}

/**
 * Creates a Helius webhook for monitoring wallet transactions
 * Based on official Helius documentation: https://www.helius.dev/docs/data-streaming/quickstart
 *
 * @param {string} walletAddress - Solana wallet address to monitor
 * @param {Object} env - Environment variables
 * @returns {Promise<Object>} Webhook creation result
 */
async function createHeliusWebhook(walletAddress, env) {
    try {
        const workerUrl = `https://${env.WORKER_DOMAIN}${HELIUS_WEBHOOK_ENDPOINT}`;

        // Following Helius official documentation structure
        const webhookData = {
            webhookURL: workerUrl,
            transactionTypes: ["Any"], // Monitor all transaction types
            accountAddresses: [walletAddress],
            webhookType: "enhanced", // Use enhanced webhooks for detailed transaction data
            txnStatus: "all", // Monitor both successful and failed transactions
            encoding: "jsonParsed" // Get parsed transaction data
        };

        const response = await fetch(`${HELIUS_API}/webhooks?api-key=${env.HELIUS_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(webhookData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Helius webhook creation error:', errorData);
            throw new Error(`Helius API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
        }

        const result = await response.json();
        console.log('Webhook created successfully:', result);
        return result;
    } catch (error) {
        console.error('Error creating Helius webhook:', error);
        throw error;
    }
}

/**
 * Deletes a Helius webhook
 *
 * @param {string} webhookId - Webhook ID to delete
 * @param {Object} env - Environment variables
 * @returns {Promise<boolean>} Deletion success
 */
async function deleteHeliusWebhook(webhookId, env) {
    try {
        const response = await fetch(`${HELIUS_API}/webhooks/${webhookId}?api-key=${env.HELIUS_API_KEY}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            console.error('Error deleting webhook:', response.status);
            return false;
        }

        console.log('Webhook deleted successfully:', webhookId);
        return true;
    } catch (error) {
        console.error('Error deleting Helius webhook:', error);
        return false;
    }
}

/**
 * Validates a Solana wallet address
 *
 * @param {string} address - Address to validate
 * @returns {boolean} Whether the address is valid
 */
function isValidSolanaAddress(address) {
    if (!address || typeof address !== 'string') return false;

    // Basic Solana address validation (base58, 32-44 characters)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
}

/**
 * Stores user wallet mapping in Cloudflare KV (if available) or in-memory
 * In production, you would use Cloudflare KV or a database
 *
 * @param {number} chatId - Telegram chat ID
 * @param {string} walletAddress - Wallet address
 * @param {string} webhookId - Helius webhook ID
 * @param {Object} env - Environment variables
 */
async function storeUserWallet(chatId, walletAddress, webhookId, env) {
    const key = `user_wallets_${chatId}`;
    let userWallets = [];

    try {
        if (env.WALLET_STORAGE) {
            const existing = await env.WALLET_STORAGE.get(key);
            if (existing) {
                userWallets = JSON.parse(existing);
            }
        }

        // Add new wallet if not already exists
        const existingWallet = userWallets.find(w => w.address === walletAddress);
        if (!existingWallet) {
            userWallets.push({
                address: walletAddress,
                webhookId: webhookId,
                addedAt: new Date().toISOString()
            });

            if (env.WALLET_STORAGE) {
                await env.WALLET_STORAGE.put(key, JSON.stringify(userWallets));
            }
        }
    } catch (error) {
        console.error('Error storing user wallet:', error);
    }
}

/**
 * Retrieves user wallets from storage
 *
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 * @returns {Promise<Array>} User's wallet list
 */
async function getUserWallets(chatId, env) {
    const key = `user_wallets_${chatId}`;

    try {
        if (env.WALLET_STORAGE) {
            const data = await env.WALLET_STORAGE.get(key);
            return data ? JSON.parse(data) : [];
        }
        return [];
    } catch (error) {
        console.error('Error retrieving user wallets:', error);
        return [];
    }
}

/**
 * Removes a wallet from user's watchlist
 *
 * @param {number} chatId - Telegram chat ID
 * @param {string} walletAddress - Wallet address to remove
 * @param {Object} env - Environment variables
 * @returns {Promise<boolean>} Removal success
 */
async function removeUserWallet(chatId, walletAddress, env) {
    const key = `user_wallets_${chatId}`;

    try {
        if (env.WALLET_STORAGE) {
            const data = await env.WALLET_STORAGE.get(key);
            if (data) {
                const userWallets = JSON.parse(data);
                const walletToRemove = userWallets.find(w => w.address === walletAddress);

                if (walletToRemove) {
                    // Delete the Helius webhook
                    await deleteHeliusWebhook(walletToRemove.webhookId, env);

                    // Remove from user's list
                    const updatedWallets = userWallets.filter(w => w.address !== walletAddress);
                    await env.WALLET_STORAGE.put(key, JSON.stringify(updatedWallets));
                    return true;
                }
            }
        }
        return false;
    } catch (error) {
        console.error('Error removing user wallet:', error);
        return false;
    }
}

/**
 * Stores wallet-to-user mapping for webhook notifications
 *
 * @param {string} walletAddress - Wallet address
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function storeWalletToUserMapping(walletAddress, chatId, env) {
    const key = `wallet_users_${walletAddress}`;

    try {
        if (env.WALLET_STORAGE) {
            let userList = [];
            const existing = await env.WALLET_STORAGE.get(key);
            if (existing) {
                userList = JSON.parse(existing);
            }

            if (!userList.includes(chatId)) {
                userList.push(chatId);
                await env.WALLET_STORAGE.put(key, JSON.stringify(userList));
            }
        }
    } catch (error) {
        console.error('Error storing wallet-to-user mapping:', error);
    }
}

/**
 * Gets users monitoring a specific wallet
 *
 * @param {string} walletAddress - Wallet address
 * @param {Object} env - Environment variables
 * @returns {Promise<Array>} List of user IDs monitoring this wallet
 */
async function getUsersForWallet(walletAddress, env) {
    const key = `wallet_users_${walletAddress}`;

    try {
        if (env.WALLET_STORAGE) {
            const data = await env.WALLET_STORAGE.get(key);
            return data ? JSON.parse(data) : [];
        }
        return [];
    } catch (error) {
        console.error('Error getting users for wallet:', error);
        return [];
    }
}

/**
 * Formats transaction details for Telegram message
 *
 * @param {Object} transaction - Transaction data from Helius
 * @returns {string} Formatted transaction message
 */
function formatTransactionMessage(transaction) {
    const { signature, err, slot, blockTime, feePayer, fee } = transaction;
    const txData = transaction.transaction || {};

    let message = `🔔 *New Transaction Detected*\n\n`;

    // Transaction status
    const status = err ? '❌ Failed' : '✅ Success';
    message += `Status: ${status}\n`;

    // Basic transaction info
    message += `Signature: \`${escapeMarkdown(signature)}\`\n`;
    message += `Slot: ${escapeMarkdown(slot.toString())}\n`;
    message += `Block Time: ${escapeMarkdown(new Date(blockTime * 1000).toLocaleString())}\n`;

    // Fee information
    if (fee) {
        message += `Fee: ${escapeMarkdown((fee / 1000000000).toFixed(6))} SOL\n`;
    }

    // Fee payer
    if (feePayer) {
        message += `Fee Payer: \`${escapeMarkdown(feePayer)}\`\n`;
    }

    // Token transfers (if available)
    if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
        message += `\n💸 *Token Transfers:*\n`;
        transaction.tokenTransfers.slice(0, 3).forEach((transfer, index) => {
            const amount = transfer.tokenAmount || 0;
            const mint = transfer.mint || 'Unknown';
            const from = transfer.fromUserAccount || 'Unknown';
            const to = transfer.toUserAccount || 'Unknown';

            message += `${index + 1}\\. ${escapeMarkdown(amount)} tokens\n`;
            message += `   Mint: \`${escapeMarkdown(mint)}\`\n`;
            message += `   From: \`${escapeMarkdown(from.substring(0, 8))}\\.\\.\\.\`\n`;
            message += `   To: \`${escapeMarkdown(to.substring(0, 8))}\\.\\.\\.\`\n\n`;
        });
    }

    // SOL transfers (if available)
    if (transaction.nativeTransfers && transaction.nativeTransfers.length > 0) {
        message += `\n💰 *SOL Transfers:*\n`;
        transaction.nativeTransfers.slice(0, 3).forEach((transfer, index) => {
            const amount = (transfer.amount || 0) / 1000000000; // Convert lamports to SOL
            const from = transfer.fromUserAccount || 'Unknown';
            const to = transfer.toUserAccount || 'Unknown';

            message += `${index + 1}\\. ${escapeMarkdown(amount.toFixed(6))} SOL\n`;
            message += `   From: \`${escapeMarkdown(from.substring(0, 8))}\\.\\.\\.\`\n`;
            message += `   To: \`${escapeMarkdown(to.substring(0, 8))}\\.\\.\\.\`\n\n`;
        });
    }

    // Explorer link
    message += `\n🔍 [View on Solscan](${SOLSCAN_BASE}/tx/${signature})`;

    return message;
}

/**
 * Sends a message to a Telegram chat
 * Handles message formatting and error handling
 * 
 * @param {number} chatId - Telegram chat ID
 * @param {string} text - Message text (with MarkdownV2 formatting)
 * @param {Object} env - Environment variables
 * @returns {Promise<Object>} Telegram API response
 */
async function sendMessage(chatId, text, env) {
    try {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        console.log('Sending message:', { chatId, text });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'MarkdownV2'
            }),
        });

        const responseData = await response.json();
        console.log('Telegram API response:', responseData);

        if (!response.ok) {
            console.error('Telegram API error:', responseData);
            throw new Error(`Telegram API error: ${response.status} - ${JSON.stringify(responseData)}`);
        }

        return responseData;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

/**
 * Escapes special characters for Telegram's MarkdownV2 format
 * This is required to properly format messages with special characters
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for MarkdownV2 format
 */
function escapeMarkdown(text) {
    if (text === undefined || text === null) return '';
    return text.toString().replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
