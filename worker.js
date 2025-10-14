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
const HELIUS_WEBHOOK_ENDPOINT = '/helius-webhook';

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

            if (method === 'POST' && path === WEBHOOK_ENDPOINT) {
                const update = await request.json();
                ctx.waitUntil(handleTelegramUpdate(update, env));
                return new Response('OK', { status: 200 });
            } else if (method === 'POST' && path === HELIUS_WEBHOOK_ENDPOINT) {
                try {
                    const transactions = await request.json();
                    console.log(`📊 Processing ${transactions.length} transactions`);
                    ctx.waitUntil(handleHeliusWebhook(transactions, env));
                    return new Response('OK', { status: 200 });
                } catch (error) {
                    console.error('❌ Helius webhook error:', error.message);
                    return new Response('Processing error', { status: 500 });
                }
            } else if (method === 'GET' && path === '/setwebhook') {
                return await setTelegramWebhook(encodeURIComponent(`${workerUrl}${WEBHOOK_ENDPOINT}`), env);
            } else if (method === 'POST' && path === '/') {
                // Helius peut parfois envoyer des webhooks à la racine
                const userAgent = request.headers.get('user-agent') || '';

                if (userAgent.includes('Helius-Webhook-Service')) {
                    try {
                        const transactions = await request.json();
                        console.log(`📊 Processing ${transactions.length} transactions at root`);
                        ctx.waitUntil(handleHeliusWebhook(transactions, env));
                        return new Response('OK', { status: 200 });
                    } catch (error) {
                        console.error('❌ Helius webhook error at root:', error.message);
                        return new Response('Invalid JSON payload', { status: 400 });
                    }
                }

                // Fallback: essayer de détecter le type de webhook par le contenu
                try {
                    const body = await request.text();
                    const jsonBody = JSON.parse(body);

                    if (jsonBody.message || jsonBody.update_id) {
                        ctx.waitUntil(handleTelegramUpdate(jsonBody, env));
                        return new Response('OK', { status: 200 });
                    } else if (Array.isArray(jsonBody) || jsonBody.signature) {
                        const transactions = Array.isArray(jsonBody) ? jsonBody : [jsonBody];
                        ctx.waitUntil(handleHeliusWebhook(transactions, env));
                        return new Response('OK', { status: 200 });
                    } else {
                        return new Response('OK - Unknown webhook type', { status: 200 });
                    }
                } catch (e) {
                    return new Response('Invalid JSON', { status: 400 });
                }
            } else if (method === 'GET' && path === '/') {
                // Page d'accueil simple pour vérifier que le worker fonctionne
                return new Response(
                    `<!DOCTYPE html>
                    <html>
                    <head><title>Solana Wallet Monitor Bot</title></head>
                    <body>
                        <h1>🚀 Solana Wallet Monitor Bot</h1>
                        <p>Bot is running successfully!</p>
                        <p>Available endpoints:</p>
                        <ul>
                            <li>POST /webhook - Telegram webhooks</li>
                            <li>POST /helius-webhook - Helius transaction notifications</li>
                            <li>GET /setwebhook - Configure Telegram webhook</li>
                        </ul>
                        <p>Time: ${new Date().toISOString()}</p>
                    </body>
                    </html>`,
                    {
                        headers: { 'Content-Type': 'text/html' },
                        status: 200
                    }
                );
            } else {
                return new Response('Not Found', { status: 404 });
            }
        } catch (error) {
            console.error('❌ Request handling error:', error);
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
        const response = await fetch(webhookUrl);
        const result = await response.json();

        if (response.ok) {
            console.log('✅ Telegram webhook configured successfully');
            return new Response('Webhook set successfully!', { status: 200 });
        } else {
            console.error('❌ Webhook setup failed:', result.description);
            return new Response(`Failed to set webhook: ${result.description}`, { status: response.status });
        }
    } catch (error) {
        console.error('❌ Webhook setup error:', error);
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
    console.log('📨 Received Telegram update:', JSON.stringify(update, null, 2));

    if (!update.message || !update.message.text) {
        console.log('❌ No message or text in update');
        return;
    }

    const chatId = update.message.chat.id;
    const text = update.message.text;
    const textLower = text.toLowerCase();

    console.log(`👤 User ${chatId} sent: "${text}"`);

    try {
        if (textLower === '/start' || textLower === '/help') {
            console.log('🔧 Processing help command');
            await sendMessage(chatId,
                'Welcome to the Solana Wallet Monitor Bot\\! 🚀\n\n' +
                'Available commands:\n' +
                '/addwallet \\<address\\> \\- Add a wallet address to monitor\n' +
                '/removewallet \\<address\\> \\- Remove a wallet address from monitoring\n' +
                '/mywallets \\- List monitored wallet addresses\n' +
                '/help \\- Show this help message',
                env
            );
        } else if (textLower.startsWith('/addwallet ')) {
            const address = text.split(' ')[1]; // Use original text, not lowercase
            console.log(`🔧 Processing addwallet command with address: "${address}"`);
            await handleAddWalletCommand(chatId, address, env);
        } else if (textLower.startsWith('/removewallet ')) {
            const address = text.split(' ')[1]; // Use original text, not lowercase
            console.log(`🔧 Processing removewallet command with address: "${address}"`);
            await handleRemoveWalletCommand(chatId, address, env);
        } else if (textLower === '/mywallets') {
            console.log('🔧 Processing mywallets command');
            await handleMyWalletsCommand(chatId, env);
        } else {
            console.log(`❓ Unknown command: "${text}"`);
        }
    } catch (error) {
        console.error('❌ Error handling update:', error);
        await sendMessage(chatId, '❌ Sorry, an error occurred\\. Please try again later\\.', env);
    }
}

/**
 * Handles the /addwallet command
 * @param {number} chatId - Telegram chat ID
 * @param {string} address - Wallet address to add
 * @param {Object} env - Environment variables
 */
async function handleAddWalletCommand(chatId, address, env) {
    console.log(`🔍 handleAddWalletCommand called with address: "${address}"`);

    try {
        if (!address) {
            console.log('❌ No address provided');
            await sendMessage(chatId,
                '❌ Please provide a wallet address\\.\n\n' +
                'Usage: `/addwallet <wallet_address>`',
                env
            );
            return;
        }

        console.log(`🔍 Validating Solana address: "${address}"`);
        console.log(`   - Length: ${address.length}`);
        console.log(`   - Trimmed: "${address.trim()}"`);

        const isValid = isValidSolanaAddress(address);
        console.log(`   - Is valid: ${isValid}`);

        if (!isValid) {
            console.log('❌ Address validation failed');
            await sendMessage(chatId,
                `❌ Invalid Solana wallet address\\.\n\n` +
                `Address: \`${escapeMarkdown(address)}\`\n` +
                `Length: ${address.length} characters\n\n` +
                `Please check the address and try again\\.`,
                env
            );
            return;
        }

        console.log('✅ Address validation passed');

        // Check if wallet is already being monitored by this user
        console.log('🔍 Checking if wallet is already monitored...');
        const userWallets = await getUserWallets(chatId, env);
        console.log(`   - User has ${userWallets.length} wallets`);

        const isAlreadyMonitored = userWallets.some(wallet => wallet.address === address);
        console.log(`   - Already monitored: ${isAlreadyMonitored}`);

        if (isAlreadyMonitored) {
            console.log('⚠️ Wallet already monitored');
            await sendMessage(chatId,
                '⚠️ This wallet address is already being monitored\\.',
                env
            );
            return;
        }

        // Create Helius webhook for this wallet
        console.log('🔍 Creating Helius webhook...');
        const webhookId = await createHeliusWebhook([address], env);
        console.log(`   - Webhook ID: ${webhookId}`);

        if (!webhookId) {
            console.log('❌ Failed to create webhook');
            await sendMessage(chatId,
                '❌ Failed to create monitoring webhook\\. Please try again later\\.',
                env
            );
            return;
        }

        // Store the wallet for this user
        console.log('🔍 Storing user wallet...');
        await storeUserWallet(chatId, address, webhookId, env);

        // Store the user-to-wallet mapping for notifications
        console.log('🔍 Storing wallet-to-user mapping...');
        await storeWalletToUserMapping(address, chatId, env);

        console.log('✅ Wallet added successfully');
        await sendMessage(chatId,
            `✅ Successfully added wallet monitoring\\!\n\n` +
            `**Address:** \`${escapeMarkdown(address.substring(0, 20))}\\.\\.\\.\`\n` +
            `You will receive notifications for all transactions involving this wallet\\.`,
            env
        );

    } catch (error) {
        console.error('❌ Error in handleAddWalletCommand:', error);
        await sendMessage(chatId,
            '❌ An error occurred while adding the wallet\\. Please try again later\\.',
            env
        );
    }
}

/**
 * Handles the /removewallet command
 * @param {number} chatId - Telegram chat ID
 * @param {string} address - Wallet address to remove
 * @param {Object} env - Environment variables
 */
async function handleRemoveWalletCommand(chatId, address, env) {
    try {
        if (!address) {
            await sendMessage(chatId,
                '❌ Please provide a wallet address\\.\n\n' +
                'Usage: `/removewallet <wallet_address>`',
                env
            );
            return;
        }

        const success = await removeUserWallet(chatId, address, env);

        if (success) {
            // Remove from wallet-to-user mapping
            await removeWalletToUserMapping(address, chatId, env);

            await sendMessage(chatId,
                `✅ Successfully removed wallet monitoring\\!\n\n` +
                `**Address:** \`${escapeMarkdown(address.substring(0, 20))}\\.\\.\\.\``,
                env
            );
        } else {
            await sendMessage(chatId,
                '❌ Wallet address not found in your monitoring list\\.',
                env
            );
        }

    } catch (error) {
        console.error('❌ Error in handleRemoveWalletCommand:', error);
        await sendMessage(chatId,
            '❌ An error occurred while removing the wallet\\. Please try again later\\.',
            env
        );
    }
}

/**
 * Handles the /mywallets command
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function handleMyWalletsCommand(chatId, env) {
    try {
        const userWallets = await getUserWallets(chatId, env);

        if (userWallets.length === 0) {
            await sendMessage(chatId,
                '📭 You are not monitoring any wallets yet\\.\n\n' +
                'Use `/addwallet <address>` to start monitoring a wallet\\.',
                env
            );
            return;
        }

        let message = `📊 **Your Monitored Wallets** \\(${userWallets.length}\\)\n\n`;

        userWallets.forEach((wallet, index) => {
            const shortAddress = `${wallet.address.substring(0, 8)}\\.\\.\\.$`;
            const addedDate = wallet.addedAt ? new Date(wallet.addedAt).toLocaleDateString() : 'Unknown';
            message += `${index + 1}\\. \`${shortAddress}\`\n`;
            message += `   📅 Added: ${escapeMarkdown(addedDate)}\n\n`;
        });

        message += 'Use `/removewallet <address>` to stop monitoring a wallet\\.';

        await sendMessage(chatId, message, env);

    } catch (error) {
        console.error('❌ Error in handleMyWalletsCommand:', error);
        await sendMessage(chatId,
            '❌ An error occurred while retrieving your wallets\\. Please try again later\\.',
            env
        );
    }
}

/**
 * Creates a Helius webhook for monitoring wallet addresses
 * @param {Array} addresses - Array of wallet addresses to monitor
 * @param {Object} env - Environment variables
 * @returns {Promise<string|null>} Webhook ID or null if failed
 */
async function createHeliusWebhook(addresses, env) {
    try {
        const webhookUrl = `${env.WORKER_URL || 'https://your-worker.workers.dev'}${HELIUS_WEBHOOK_ENDPOINT}`;

        const webhookData = {
            webhookURL: webhookUrl,
            transactionTypes: ["Any"],
            accountAddresses: addresses,
            webhookType: "enhanced"
        };

        const response = await fetch(`${HELIUS_API}/webhooks?api-key=${env.HELIUS_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(webhookData)
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('❌ Helius webhook creation failed:', response.status, errorData);
            return null;
        }

        const result = await response.json();
        console.log('✅ Helius webhook created:', result.webhookID);
        return result.webhookID;

    } catch (error) {
        console.error('❌ Error creating Helius webhook:', error);
        return null;
    }
}

/**
 * Removes a user from the wallet-to-user mapping
 * @param {string} address - Wallet address
 * @param {number} chatId - Telegram chat ID to remove
 * @param {Object} env - Environment variables
 */
async function removeWalletToUserMapping(address, chatId, env) {
    try {
        if (!env.WALLET_STORAGE) {
            return;
        }

        const key = `wallet_users_${address}`;
        const existingData = await env.WALLET_STORAGE.get(key);

        if (!existingData) {
            return;
        }

        const users = JSON.parse(existingData);
        const userIndex = users.indexOf(chatId);

        if (userIndex > -1) {
            users.splice(userIndex, 1);

            if (users.length > 0) {
                await env.WALLET_STORAGE.put(key, JSON.stringify(users));
            } else {
                await env.WALLET_STORAGE.delete(key);
            }
        }
    } catch (error) {
        console.error('❌ Error removing wallet-to-user mapping:', error);
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
    try {
        // Helius sends an array of transactions
        if (!Array.isArray(transactions)) {
            console.error('❌ Invalid webhook payload: expected array');
            return;
        }

        if (transactions.length === 0) {
            return;
        }

        // Limit processing to avoid timeouts on large batches
        const maxTransactions = 50;
        const transactionsToProcess = transactions.slice(0, maxTransactions);

        let totalNotifications = 0;

        // Process each transaction and notify relevant users
        for (const transaction of transactionsToProcess) {
            try {
                // Validate transaction structure according to Helius docs
                if (!transaction || !transaction.signature || !transaction.slot) {
                    continue;
                }

                // Format the transaction message with error handling
                let message;
                try {
                    message = formatTransactionMessage(transaction);
                } catch (formatError) {
                    console.error('❌ Error formatting transaction:', formatError.message);
                    continue;
                }

                // Get wallet addresses involved in this transaction
                const involvedAddresses = extractInvolvedAddresses(transaction);

                // Notify users monitoring any of these addresses
                const notifiedUsers = new Set();

                for (const address of involvedAddresses) {
                    try {
                        const users = await getUsersForWallet(address, env);
                        for (const userId of users) {
                            if (!notifiedUsers.has(userId)) {
                                notifiedUsers.add(userId);
                                try {
                                    await sendMessage(userId, message, env);
                                    totalNotifications++;
                                } catch (sendError) {
                                    console.error(`❌ Failed to notify user ${userId}:`, sendError.message);
                                }
                            }
                        }
                    } catch (getUserError) {
                        console.error(`❌ Error getting users for wallet:`, getUserError.message);
                    }
                }

            } catch (transactionError) {
                console.error('❌ Error processing transaction:', transactionError.message);
                // Continue processing other transactions
            }
        }

        if (totalNotifications > 0) {
            console.log(`✅ Sent ${totalNotifications} notifications for ${transactionsToProcess.length} transactions`);
        }

    } catch (error) {
        console.error('❌ Critical error in handleHeliusWebhook:', error);
        throw error; // Re-throw to be caught by main handler
    }
}

/**
 * Extracts all wallet addresses involved in a transaction
 * @param {Object} transaction - Transaction data from Helius
 * @returns {Set} Set of involved wallet addresses
 */
function extractInvolvedAddresses(transaction) {
    const involvedAddresses = new Set();

    // Add fee payer (always present in Helius enhanced webhooks)
    if (transaction.feePayer) {
        involvedAddresses.add(transaction.feePayer);
    }

    // Add addresses from account keys (Helius enhanced format)
    if (transaction.accountData && Array.isArray(transaction.accountData)) {
        transaction.accountData.forEach(account => {
            if (account && account.account) {
                involvedAddresses.add(account.account);
            }
        });
    }

    // Add addresses from token transfers (Helius enhanced format)
    if (transaction.tokenTransfers && Array.isArray(transaction.tokenTransfers)) {
        transaction.tokenTransfers.forEach(transfer => {
            if (transfer) {
                if (transfer.fromUserAccount) involvedAddresses.add(transfer.fromUserAccount);
                if (transfer.toUserAccount) involvedAddresses.add(transfer.toUserAccount);
            }
        });
    }

    // Add addresses from native transfers (Helius enhanced format)
    if (transaction.nativeTransfers && Array.isArray(transaction.nativeTransfers)) {
        transaction.nativeTransfers.forEach(transfer => {
            if (transfer) {
                if (transfer.fromUserAccount) involvedAddresses.add(transfer.fromUserAccount);
                if (transfer.toUserAccount) involvedAddresses.add(transfer.toUserAccount);
            }
        });
    }

    // Add addresses from instruction accounts (fallback for standard format)
    if (transaction.transaction && transaction.transaction.message && transaction.transaction.message.accountKeys) {
        transaction.transaction.message.accountKeys.forEach(key => {
            if (key) {
                if (typeof key === 'string') {
                    involvedAddresses.add(key);
                } else if (key.pubkey) {
                    involvedAddresses.add(key.pubkey);
                }
            }
        });
    }

    return involvedAddresses;
}

/**
 * Formats a transaction from Helius webhook into a readable Telegram message
 * @param {Object} transaction - Transaction data from Helius
 * @returns {string} Formatted message for Telegram
 */
function formatTransactionMessage(transaction) {
    try {
        const signature = transaction.signature;
        const slot = transaction.slot;
        const timestamp = transaction.timestamp ? new Date(transaction.timestamp * 1000).toLocaleString() : 'Unknown';

        let message = `🔔 *New Transaction Alert\\!*\n\n`;
        message += `**Signature:** \`${escapeMarkdown(signature.substring(0, 20))}\\.\\.\\.\`\n`;
        message += `**Slot:** ${escapeMarkdown(slot.toString())}\n`;
        message += `**Time:** ${escapeMarkdown(timestamp)}\n`;

        // Add transaction type if available
        if (transaction.type) {
            message += `**Type:** ${escapeMarkdown(transaction.type)}\n`;
        }

        // Add fee information
        if (transaction.fee) {
            const feeInSol = (transaction.fee / 1000000000).toFixed(6);
            message += `**Fee:** ${escapeMarkdown(feeInSol)} SOL\n`;
        }

        // Add native transfers if present
        if (transaction.nativeTransfers && transaction.nativeTransfers.length > 0) {
            message += `\n💰 **Native Transfers:**\n`;
            transaction.nativeTransfers.forEach((transfer, index) => {
                if (index < 3) { // Limit to first 3 transfers
                    const amount = (transfer.amount / 1000000000).toFixed(6);
                    const from = transfer.fromUserAccount ?
                        `${transfer.fromUserAccount.substring(0, 8)}\\.\\.\\.$` :
                        'Unknown';
                    const to = transfer.toUserAccount ?
                        `${transfer.toUserAccount.substring(0, 8)}\\.\\.\\.$` :
                        'Unknown';
                    message += `• ${escapeMarkdown(amount)} SOL: ${from} → ${to}\n`;
                }
            });
            if (transaction.nativeTransfers.length > 3) {
                message += `• \\.\\.\\. and ${transaction.nativeTransfers.length - 3} more transfers\n`;
            }
        }

        // Add token transfers if present
        if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
            message += `\n🪙 **Token Transfers:**\n`;
            transaction.tokenTransfers.forEach((transfer, index) => {
                if (index < 3) { // Limit to first 3 transfers
                    const symbol = transfer.tokenAmount?.uiTokenAmount?.tokenSymbol || 'Unknown Token';
                    const amount = transfer.tokenAmount?.uiTokenAmount?.uiAmountString || '0';
                    const from = transfer.fromUserAccount ?
                        `${transfer.fromUserAccount.substring(0, 8)}\\.\\.\\.$` :
                        'Unknown';
                    const to = transfer.toUserAccount ?
                        `${transfer.toUserAccount.substring(0, 8)}\\.\\.\\.$` :
                        'Unknown';
                    message += `• ${escapeMarkdown(amount)} ${escapeMarkdown(symbol)}: ${from} → ${to}\n`;
                }
            });
            if (transaction.tokenTransfers.length > 3) {
                message += `• \\.\\.\\. and ${transaction.tokenTransfers.length - 3} more transfers\n`;
            }
        }

        message += `\n[View on Solscan](${SOLSCAN_BASE}/tx/${signature})`;

        return message;
    } catch (error) {
        console.error('❌ Error formatting transaction message:', error);
        return `🔔 *Transaction Alert*\n\nSignature: \`${escapeMarkdown(transaction.signature.substring(0, 20))}\\.\\.\\.\`\n\n[View on Solscan](${SOLSCAN_BASE}/tx/${transaction.signature})`;
    }
}

/**
 * Sends a message to a Telegram chat
 * @param {number} chatId - Telegram chat ID
 * @param {string} text - Message text (supports MarkdownV2)
 * @param {Object} env - Environment variables
 */
async function sendMessage(chatId, text, env) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'MarkdownV2',
                disable_web_page_preview: true
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Telegram API error: ${response.status} - ${errorData.description}`);
        }

        return await response.json();
    } catch (error) {
        console.error('❌ Error sending message:', error.message);
        throw error;
    }
}

/**
 * Stores a wallet address for a user
 * @param {number} chatId - Telegram chat ID
 * @param {string} address - Wallet address
 * @param {string} webhookId - Helius webhook ID
 * @param {Object} env - Environment variables
 */
async function storeUserWallet(chatId, address, webhookId, env) {
    try {
        if (!env.WALLET_STORAGE) {
            throw new Error('WALLET_STORAGE not configured');
        }

        const key = `user_wallets_${chatId}`;
        const existingData = await env.WALLET_STORAGE.get(key);
        const wallets = existingData ? JSON.parse(existingData) : [];

        const newWallet = {
            address: address,
            webhookId: webhookId,
            addedAt: new Date().toISOString()
        };

        wallets.push(newWallet);
        await env.WALLET_STORAGE.put(key, JSON.stringify(wallets));
    } catch (error) {
        console.error('❌ Error storing user wallet:', error.message);
        throw error;
    }
}

/**
 * Removes a wallet address from a user's list
 * @param {number} chatId - Telegram chat ID
 * @param {string} address - Wallet address to remove
 * @param {Object} env - Environment variables
 * @returns {boolean} Success status
 */
async function removeUserWallet(chatId, address, env) {
    try {
        if (!env.WALLET_STORAGE) {
            throw new Error('WALLET_STORAGE not configured');
        }

        const key = `user_wallets_${chatId}`;
        const existingData = await env.WALLET_STORAGE.get(key);

        if (!existingData) {
            return false;
        }

        const wallets = JSON.parse(existingData);
        const walletIndex = wallets.findIndex(w => w.address === address);

        if (walletIndex === -1) {
            return false;
        }

        const removedWallet = wallets[walletIndex];

        // Delete Helius webhook if webhookId exists
        if (removedWallet.webhookId) {
            await deleteHeliusWebhook(removedWallet.webhookId, env);
        }

        wallets.splice(walletIndex, 1);

        if (wallets.length > 0) {
            await env.WALLET_STORAGE.put(key, JSON.stringify(wallets));
        } else {
            await env.WALLET_STORAGE.delete(key);
        }

        return true;
    } catch (error) {
        console.error('❌ Error removing user wallet:', error.message);
        throw error;
    }
}

/**
 * Gets all wallet addresses monitored by a user
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 * @returns {Array} Array of wallet objects
 */
async function getUserWallets(chatId, env) {
    try {
        if (!env.WALLET_STORAGE) {
            return [];
        }

        const key = `user_wallets_${chatId}`;
        const data = await env.WALLET_STORAGE.get(key);
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('❌ Error getting user wallets:', error.message);
        return [];
    }
}

/**
 * Stores the mapping of wallet address to users monitoring it
 * @param {string} address - Wallet address
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function storeWalletToUserMapping(address, chatId, env) {
    try {
        if (!env.WALLET_STORAGE) {
            throw new Error('WALLET_STORAGE not configured');
        }

        const key = `wallet_users_${address}`;
        const existingData = await env.WALLET_STORAGE.get(key);
        const users = existingData ? JSON.parse(existingData) : [];

        if (!users.includes(chatId)) {
            users.push(chatId);
            await env.WALLET_STORAGE.put(key, JSON.stringify(users));
        }
    } catch (error) {
        console.error('❌ Error storing wallet-to-user mapping:', error.message);
        throw error;
    }
}

/**
 * Gets all users monitoring a specific wallet address
 * @param {string} address - Wallet address
 * @param {Object} env - Environment variables
 * @returns {Array} Array of chat IDs
 */
async function getUsersForWallet(address, env) {
    try {
        if (!env.WALLET_STORAGE) {
            return [];
        }

        const key = `wallet_users_${address}`;
        const data = await env.WALLET_STORAGE.get(key);
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('❌ Error getting users for wallet:', error.message);
        return [];
    }
}

/**
 * Validates if a string is a valid Solana address
 * @param {string} address - Address to validate
 * @returns {boolean} Validation result
 */
function isValidSolanaAddress(address) {
    if (!address || typeof address !== 'string') {
        return false;
    }

    // Remove any whitespace
    address = address.trim();

    // Solana addresses are base58 encoded and exactly 32-44 characters
    // Base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

    if (!base58Regex.test(address)) {
        return false;
    }

    // Additional validation: check for common invalid patterns
    // Solana addresses shouldn't be all the same character
    if (/^(.)\1+$/.test(address)) {
        return false;
    }

    // Most Solana addresses are 44 characters, but some system accounts can be shorter
    // Accept addresses between 32-44 characters that match base58 pattern
    return true;
}

/**
 * Escapes special characters for Telegram MarkdownV2
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeMarkdown(text) {
    if (!text) return '';
    return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
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
            console.error('❌ Error deleting webhook:', response.status);
            return false;
        }

        console.log(`✅ Webhook deleted: ${webhookId}`);
        return true;
    } catch (error) {
        console.error('❌ Error deleting Helius webhook:', error.message);
        return false;
    }
}
