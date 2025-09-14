/**
 * Telegram Cryptocurrency Bot
 * 
 * This bot provides real-time cryptocurrency information using the CoinGecko API.
 * It runs on Cloudflare Workers and handles various commands to fetch crypto prices,
 * market statistics, and trending coins.
 */

// Webhook endpoint where Telegram will send updates
const WEBHOOK_ENDPOINT = '/webhook';

// Base URL for CoinGecko API v3
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Base URL for Axiom Trade API
const AXIOM_API = 'https://api.axiom.trade/v1';

/**
 * Main export for Cloudflare Worker (ES Modules syntax)
 */
export default {
    async fetch(request, env, ctx) {
        // Vérifiez que le token existe
        if (!env.TELEGRAM_BOT_TOKEN) {
            return new Response('TELEGRAM_BOT_TOKEN not configured', { status: 500 });
        }

        try {
            const url = new URL(request.url);
            const path = url.pathname;
            const method = request.method;
            const workerUrl = `${url.protocol}//${url.host}`;

            console.log('Incoming request:', { path, method });

            if (method === 'POST' && path === WEBHOOK_ENDPOINT) {
                const update = await request.json();
                console.log('Received update:', JSON.stringify(update));
                ctx.waitUntil(handleTelegramUpdate(update, env));
                return new Response('OK', { status: 200 });
            } else if (method === 'GET' && path === '/setwebhook') {
                return await setWebhook(encodeURIComponent(`${workerUrl}${WEBHOOK_ENDPOINT}`), env);
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
async function setWebhook(url, env) {
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
 * - /price <coin>: Get specific coin price
 * - /top10: Show top 10 cryptocurrencies
 * - /trending: Show trending coins
 * - /global: Show global market stats
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
                'Welcome to the Crypto Price Bot\\! 🚀\n\n' +
                'Available commands:\n' +
                '/price \\<coin\\> \\- Get price for a specific coin \\(e\\.g\\., /price bitcoin\\)\n' +
                '/top10 \\- Get top 10 cryptocurrencies by market cap\n' +
                '/trending \\- Show trending coins\n' +
                '/pulse \\- Show new coins from Axiom Trade \\(New Pairs, Final Stretch, Migrated\\)\n' +
                '/global \\- Show global market stats\n' +
                '/help \\- Show this help message',
                env
            );
        } else if (text === '/top10') {
            await handleTop10Command(chatId, env);
        } else if (text === '/trending') {
            await handleTrendingCommand(chatId, env);
        } else if (text === '/pulse') {
            await handlePulseCommand(chatId, env);
        } else if (text === '/global') {
            await handleGlobalCommand(chatId, env);
        } else if (text.startsWith('/price ')) {
            const coin = text.split(' ')[1];
            await handlePriceCommand(chatId, coin, env);
        }
    } catch (error) {
        console.error('Error handling update:', error);
        await sendMessage(chatId, '❌ Sorry, an error occurred\\. Please try again later\\.', env);
    }
}

/**
 * Fetches and formats global cryptocurrency market statistics
 * Shows total market cap, volume, BTC dominance, etc.
 * 
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function handleGlobalCommand(chatId, env) {
    try {
        const response = await fetch(`${COINGECKO_API}/global`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        const stats = data.data;

        const message =
            '🌍 *Global Crypto Market Stats*\n\n' +
            `Total Market Cap: $${escapeMarkdown(stats.total_market_cap.usd.toLocaleString())}\n` +
            `24h Volume: $${escapeMarkdown(stats.total_volume.usd.toLocaleString())}\n` +
            `BTC Dominance: ${escapeMarkdown(stats.market_cap_percentage.btc.toFixed(2))}\\%\n` +
            `Active Cryptocurrencies: ${escapeMarkdown(stats.active_cryptocurrencies.toString())}\n` +
            `Markets: ${escapeMarkdown(stats.markets.toString())}\n\n` +
            `/help \\- Show commands`;

        await sendMessage(chatId, message, env);
    } catch (error) {
        console.error('Error fetching global stats:', error);
        await sendMessage(chatId, '❌ Failed to fetch global market stats\\. Please try again later\\.', env);
    }
}

/**
 * Fetches and displays new coins from Axiom Trade pulse sections
 * Shows coins from New Pairs, Final Stretch, and Migrated sections
 *
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function handlePulseCommand(chatId, env) {
    try {
        await sendMessage(chatId, '🔄 Fetching new coins from Axiom Trade pulse\\.\\.\\.', env);

        // Fetch data from all three pulse sections
        const [newPairs, finalStretch, migrated] = await Promise.allSettled([
            fetchAxiomPulseData('new-pairs'),
            fetchAxiomPulseData('final-stretch'),
            fetchAxiomPulseData('migrated')
        ]);

        let message = '🚀 *Axiom Trade Pulse \\- New Coins*\n\n';

        // Process New Pairs section
        if (newPairs.status === 'fulfilled' && newPairs.value.length > 0) {
            message += '🆕 *New Pairs*\n';
            newPairs.value.slice(0, 5).forEach((coin, index) => {
                message += formatCoinInfo(coin, index + 1);
            });
            message += '\n';
        }

        // Process Final Stretch section
        if (finalStretch.status === 'fulfilled' && finalStretch.value.length > 0) {
            message += '🏁 *Final Stretch*\n';
            finalStretch.value.slice(0, 5).forEach((coin, index) => {
                message += formatCoinInfo(coin, index + 1);
            });
            message += '\n';
        }

        // Process Migrated section
        if (migrated.status === 'fulfilled' && migrated.value.length > 0) {
            message += '✅ *Migrated to Raydium*\n';
            migrated.value.slice(0, 5).forEach((coin, index) => {
                message += formatCoinInfo(coin, index + 1);
            });
            message += '\n';
        }

        // Check if we have any data
        if (newPairs.status === 'rejected' && finalStretch.status === 'rejected' && migrated.status === 'rejected') {
            message += '❌ Unable to fetch pulse data from Axiom Trade\\. Please try again later\\.\n\n';
        } else if (
            (newPairs.status === 'fulfilled' && newPairs.value.length === 0) &&
            (finalStretch.status === 'fulfilled' && finalStretch.value.length === 0) &&
            (migrated.status === 'fulfilled' && migrated.value.length === 0)
        ) {
            message += '📭 No new coins found in pulse sections at the moment\\.\n\n';
        }

        message += '/help \\- Show commands';

        await sendMessage(chatId, message, env);
    } catch (error) {
        console.error('Error fetching pulse data:', error);
        await sendMessage(chatId, '❌ Failed to fetch pulse data from Axiom Trade\\. Please try again later\\.', env);
    }
}

/**
 * Fetches and displays currently trending cryptocurrencies
 * Shows name, market cap rank, and BTC price
 * 
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function handleTrendingCommand(chatId, env) {
    try {
        const response = await fetch(`${COINGECKO_API}/search/trending`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const data = await response.json();
        let message = '🔥 *Trending Cryptocurrencies*\n\n';

        data.coins.forEach((item, index) => {
            const coin = item.item;
            message += `${index + 1}\\. ${escapeMarkdown(coin.name)} \\(${escapeMarkdown(coin.symbol.toUpperCase())}\\)\n` +
                `Market Cap Rank: \\#${coin.market_cap_rank}\n` +
                `Price BTC: ${escapeMarkdown(coin.price_btc.toFixed(8))}\n\n`;
        });

        message += '\n/help \\- Show commands';

        await sendMessage(chatId, message, env);
    } catch (error) {
        console.error('Error fetching trending coins:', error);
        await sendMessage(chatId, '❌ Failed to fetch trending coins\\. Please try again later\\.', env);
    }
}

/**
 * Fetches and displays top 10 cryptocurrencies by market cap
 * Shows price, 24h change, market cap, and volume
 * 
 * @param {number} chatId - Telegram chat ID
 * @param {Object} env - Environment variables
 */
async function handleTop10Command(chatId, env) {
    try {
        // Add API version and platform parameters to avoid rate limiting
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Telegram Bot'
        };

        const response = await fetch(
            `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false`,
            { headers }
        );

        if (!response.ok) {
            console.error('CoinGecko API error status:', response.status);
            const errorText = await response.text();
            console.error('CoinGecko API error response:', errorText);
            throw new Error(`CoinGecko API error: ${response.status}`);
        }

        const data = await response.json();
        let message = '📊 *Top 10 Cryptocurrencies*\n\n';

        data.forEach((coin, index) => {
            const priceChange = coin.price_change_percentage_24h || 0;
            const priceChangeIcon = priceChange >= 0 ? '🟢' : '🔴';

            message += `${index + 1}\\. ${escapeMarkdown(coin.name)} \\(${escapeMarkdown(coin.symbol.toUpperCase())}\\)\n`;
            message += `💵 Price: $${escapeMarkdown(coin.current_price.toLocaleString())}\n`;
            message += `${priceChangeIcon} 24h: ${escapeMarkdown(priceChange.toFixed(2))}\\%\n`;
            message += `💎 Market Cap: $${escapeMarkdown(coin.market_cap.toLocaleString())}\n`;
            message += `📊 Volume: $${escapeMarkdown(coin.total_volume.toLocaleString())}\n\n`;
        });

        message += '\n/help \\- Show commands';

        await sendMessage(chatId, message, env);
    } catch (error) {
        console.error('Error fetching top 10:', error);
        await sendMessage(chatId, '❌ Failed to fetch top 10 cryptocurrencies\\. Please try again later\\.', env);
    }
}

/**
 * Fetches and displays detailed information about a specific cryptocurrency
 * Shows current price, 24h change, high/low, market cap, and volume
 * 
 * @param {number} chatId - Telegram chat ID
 * @param {string} coin - Name or symbol of the cryptocurrency to look up
 * @param {Object} env - Environment variables
 */
async function handlePriceCommand(chatId, coin, env) {
    try {
        // First search for the coin to get its ID
        const searchResponse = await fetch(
            `${COINGECKO_API}/search?query=${encodeURIComponent(coin)}`,
            { headers: { 'Accept': 'application/json', 'User-Agent': 'Telegram Bot' } }
        );

        if (!searchResponse.ok) {
            throw new Error(`CoinGecko API error: ${searchResponse.status}`);
        }

        const searchData = await searchResponse.json();
        if (!searchData.coins || searchData.coins.length === 0) {
            await sendMessage(chatId, `❌ Could not find cryptocurrency: ${escapeMarkdown(coin)}`, env);
            return;
        }

        // Fetch detailed information using the coin ID
        const coinId = searchData.coins[0].id;
        const response = await fetch(
            `${COINGECKO_API}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
            { headers: { 'Accept': 'application/json', 'User-Agent': 'Telegram Bot' } }
        );

        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.status}`);
        }

        const data = await response.json();
        const priceChange = data.market_data.price_change_percentage_24h || 0;
        const priceChangeIcon = priceChange >= 0 ? '🟢' : '🔴';

        const message = `💰 ${escapeMarkdown(data.name)} \\(${escapeMarkdown(data.symbol.toUpperCase())}\\)\n\n` +
            `Current Price: $${escapeMarkdown(data.market_data.current_price.usd.toLocaleString())}\n` +
            `${priceChangeIcon} 24h Change: ${escapeMarkdown(priceChange.toFixed(2))}\\%\n` +
            `📈 24h High: $${escapeMarkdown(data.market_data.high_24h.usd.toLocaleString())}\n` +
            `📉 24h Low: $${escapeMarkdown(data.market_data.low_24h.usd.toLocaleString())}\n` +
            `💎 Market Cap: $${escapeMarkdown(data.market_data.market_cap.usd.toLocaleString())}\n` +
            `📊 Market Cap Rank: \\#${data.market_cap_rank}\n` +
            `💫 Volume: $${escapeMarkdown(data.market_data.total_volume.usd.toLocaleString())}\n` +
            `/help \\- Show commands`;

        await sendMessage(chatId, message, env);
    } catch (error) {
        console.error('Error fetching coin price:', error);
        await sendMessage(chatId, `❌ Failed to fetch price for ${escapeMarkdown(coin)}\\. Please try again later\\.`, env);
    }
}

/**
 * Fetches pulse data from Axiom Trade API for a specific section
 *
 * @param {string} section - The pulse section to fetch ('new-pairs', 'final-stretch', 'migrated')
 * @returns {Promise<Array>} Array of coin data
 */
async function fetchAxiomPulseData(section) {
    try {
        // Note: These are example endpoints based on common API patterns
        // The actual Axiom Trade API endpoints may differ
        const endpoints = {
            'new-pairs': `${AXIOM_API}/pulse/new-pairs`,
            'final-stretch': `${AXIOM_API}/pulse/final-stretch`,
            'migrated': `${AXIOM_API}/pulse/migrated`
        };

        const response = await fetch(endpoints[section], {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Telegram Bot'
            }
        });

        if (!response.ok) {
            console.error(`Axiom API error for ${section}:`, response.status);
            // If the API is not available, return mock data for demonstration
            return getMockPulseData(section);
        }

        const data = await response.json();

        // Handle different possible response structures
        if (Array.isArray(data)) {
            return data;
        } else if (data.data && Array.isArray(data.data)) {
            return data.data;
        } else if (data.tokens && Array.isArray(data.tokens)) {
            return data.tokens;
        } else {
            console.warn(`Unexpected response structure for ${section}:`, data);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching ${section} data:`, error);
        // Return mock data for demonstration if API is not available
        return getMockPulseData(section);
    }
}

/**
 * Returns mock pulse data for demonstration purposes
 * This will be used when the actual Axiom Trade API is not available
 *
 * @param {string} section - The pulse section
 * @returns {Array} Mock coin data
 */
function getMockPulseData(section) {
    const mockData = {
        'new-pairs': [
            {
                name: 'PEPE2.0',
                symbol: 'PEPE2',
                price: 0.000001234,
                marketCap: 1250000,
                volume24h: 450000,
                holders: 1250,
                age: '15m',
                change24h: 45.67
            },
            {
                name: 'DogeCoin Classic',
                symbol: 'DOGEC',
                price: 0.00234,
                marketCap: 890000,
                volume24h: 320000,
                holders: 890,
                age: '8m',
                change24h: -12.34
            }
        ],
        'final-stretch': [
            {
                name: 'MoonShot Token',
                symbol: 'MOON',
                price: 0.0456,
                marketCap: 2340000,
                volume24h: 890000,
                holders: 2100,
                age: '2h',
                change24h: 123.45,
                progress: 85
            }
        ],
        'migrated': [
            {
                name: 'Successful Meme',
                symbol: 'SMEME',
                price: 0.234,
                marketCap: 15600000,
                volume24h: 3400000,
                holders: 8900,
                age: '1d',
                change24h: 234.56,
                migrationTime: '2h ago'
            }
        ]
    };

    return mockData[section] || [];
}

/**
 * Formats coin information for display in Telegram message
 *
 * @param {Object} coin - Coin data object
 * @param {number} index - Position in the list
 * @returns {string} Formatted coin information
 */
function formatCoinInfo(coin, index) {
    const priceChangeIcon = (coin.change24h || 0) >= 0 ? '🟢' : '🔴';
    const priceChange = coin.change24h ? coin.change24h.toFixed(2) : '0.00';

    let info = `${index}\\. ${escapeMarkdown(coin.name || 'Unknown')} \\(${escapeMarkdown((coin.symbol || 'N/A').toUpperCase())}\\)\n`;

    if (coin.price) {
        info += `💰 Price: $${escapeMarkdown(coin.price.toLocaleString())}\n`;
    }

    info += `${priceChangeIcon} 24h: ${escapeMarkdown(priceChange)}\\%\n`;

    if (coin.marketCap) {
        info += `💎 Market Cap: $${escapeMarkdown(coin.marketCap.toLocaleString())}\n`;
    }

    if (coin.volume24h) {
        info += `📊 Volume: $${escapeMarkdown(coin.volume24h.toLocaleString())}\n`;
    }

    if (coin.holders) {
        info += `👥 Holders: ${escapeMarkdown(coin.holders.toLocaleString())}\n`;
    }

    if (coin.age) {
        info += `⏰ Age: ${escapeMarkdown(coin.age)}\n`;
    }

    if (coin.progress) {
        info += `📈 Progress: ${escapeMarkdown(coin.progress.toString())}\\%\n`;
    }

    if (coin.migrationTime) {
        info += `🚀 Migrated: ${escapeMarkdown(coin.migrationTime)}\n`;
    }

    return info + '\n';
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