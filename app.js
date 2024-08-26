require('dotenv').config();
const infuraProjectId = process.env.INFURA_PROJECT_ID;
const express = require('express');
const { Web3 } = require('web3');
const { ethers } = require("ethers");


const app = express();
app.use(express.json());

// Ethereum ERC20 token contract addresses
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const ERC20_ABI = [
  // Minimal ERC20 ABI for balanceOf
  {
    "constant": true,
    "inputs": [{ "name": "_owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "balance", "type": "uint256" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
];


// Function to initialize Web3 with Infura for Ethereum
async function initWeb3(infuraProjectId) {
  const INFURA_URL = `https://mainnet.infura.io/v3/${infuraProjectId}`;
  const web3 = new Web3(new Web3.providers.HttpProvider(INFURA_URL));
  const provider = new ethers.providers.JsonRpcProvider(INFURA_URL);

  return { web3, provider };
}


// API endpoint to get wallet info
app.post('/wallet-info', async (req, res) => {
  const { chain, walletAddress } = req.body;
  const infuraUrl = `https://mainnet.infura.io/v3/${infuraProjectId}`;
  try {
    if (chain === 'ethereum') {
      const { web3, provider } = await initWeb3(infuraProjectId);
      const balances = await getEthereumWalletInfo(web3, provider, walletAddress);
      res.json({
        balances
      });
    } else {
      res.status(400).json({ error: 'Unsupported chain' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


// Function to get Ethereum wallet info
async function getEthereumWalletInfo(web3, provider, walletAddress) {
  const ethBalance = await web3.eth.getBalance(walletAddress);
  const usdcBalance = await getTokenBalance(web3, USDC_ADDRESS, walletAddress);
  const usdtBalance = await getTokenBalance(web3, USDT_ADDRESS, walletAddress);
  const ethVolume = await getTransferVolume(provider, null, walletAddress, web3);
  const usdcVolume = await getTransferVolume(provider, USDC_ADDRESS, walletAddress, web3);
  const usdtVolume = await getTransferVolume(provider, USDT_ADDRESS, walletAddress, web3);
  return {
    balances: {
      ETH: web3.utils.fromWei(ethBalance, 'ether'),
      USDC: usdcBalance,
      USDT: usdtBalance
    },
    transferVolumeLast24h: {
      ETH: ethVolume,
      USDC: usdcVolume,
      USDT: usdtVolume
    }
  };
}


// Function to get token balance for Ethereum
async function getTokenBalance(web3, tokenAddress, walletAddress) {
  const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const balance = await contract.methods.balanceOf(walletAddress).call();
  return web3.utils.fromWei(balance, 'mwei');
}


// Function to get 24-hour transfer volume for Ethereum
async function getTransferVolume(provider, tokenAddress, walletAddress, web3) {
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = latestBlock - 7200; // 7200, Last ~24 hours of blocks
  let events;
  if (tokenAddress) {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const transferFilter = {
      address: contract.address,
      topics: [
        ethers.utils.id('Transfer(address,address,uint256)'),
        ethers.utils.hexZeroPad(walletAddress, 32),
        null
      ]
    };
    
    events = await contract.queryFilter(transferFilter, fromBlock, 'latest');
  } else {
    events = await getEthTransfers(web3, provider, walletAddress, fromBlock, latestBlock);
  }

  // Initialize the volume to zero
  let volume = ethers.BigNumber.from(0);

  // Safely process the events
  for (const event of events) {

    // Convert the HEX data to BigNumber
    const valueHex = event.data; // The HEX format data from the event
    const value = ethers.BigNumber.from(valueHex); // Convert HEX to BigNumber

    // Log the value before addition
    volume = volume.add(value);
  }
  return ethers.utils.formatUnits(volume, tokenAddress ? 6 : 'ether');
}


// Function to get ETH transfers
async function getEthTransfers(web3, provider, address, fromBlock, toBlock) {

  const transfers = [];
  const batchSize = 100; // Adjust this value based on the API rate limits

  // Fetch transfers in batches to avoid hitting API limits
  for (let i = fromBlock; i <= toBlock; i += batchSize) {
    const endBlock = Math.min(i + batchSize - 1, toBlock);

    // Prepare the JSON request body
    const requestBody = {
      fromBlock: web3.utils.toHex(i),
      toBlock: web3.utils.toHex(endBlock),
      address: address,
      topics: [web3.utils.sha3('Transfer(address,address,uint256)')]
    };

    // Send the request to Infura
    const batchTransfers = await provider.send("eth_getLogs", [requestBody]);

    transfers.push(...batchTransfers);
  }
  return transfers.map(log => ({ ...log, value: ethers.BigNumber.from(log.data) }));
}


// Start the server
const PORT = process.env.PORT || 8080;  // Use the environment's PORT or default to 8080
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));