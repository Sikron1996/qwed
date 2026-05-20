import { createAppKit } from "https://esm.sh/@reown/appkit@1.6.8";
import { EthersAdapter } from "https://esm.sh/@reown/appkit-adapter-ethers@1.6.8";
import { mainnet } from "https://esm.sh/@reown/appkit/networks";
import { ethers } from "https://esm.sh/ethers@6.13.4";

// Встав сюди адресу контракту після deploy
const CONTRACT_ADDRESS = "PASTE_CONTRACT_ADDRESS_HERE";

// Твій Reown Project ID
const PROJECT_ID = "fe55ea601c3e7e0925c0b33723d6b158";

const ABI = [
  "function mint(uint256 amount) external payable",
  "function PRICE() view returns (uint256)",
  "function minted(address user) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)"
];

const MAX_SUPPLY = 10000;
const DEFAULT_PRICE_ETH = "0.0001";

const appKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [mainnet],
  metadata: {
    name: "AsciiPunks",
    description: "AsciiPunks mint site",
    url: window.location.origin,
    icons: [window.location.origin + "/assets/preview1.jpeg"]
  },
  projectId: PROJECT_ID,
  features: {
    analytics: false,
    email: false,
    socials: false
  }
});

let provider = null, signer = null, contract = null, account = null;
let cachedPriceWei = null, cachedAlreadyMinted = 0n;

const walletEl = document.getElementById("wallet");
const statusEl = document.getElementById("status");
const amountInput = document.getElementById("amountInput");
const progressBar = document.getElementById("progressBar");
const mintedText = document.getElementById("mintedText");
const priceText = document.getElementById("priceText");
const galleryEl = document.getElementById("gallery");
const openseaLink = document.getElementById("openseaLink");
const etherscanLink = document.getElementById("etherscanLink");

function status(msg){ statusEl.textContent = msg; }
function ipfsToHttp(uri){ return uri && uri.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + uri.replace("ipfs://","") : uri; }
function getAmount(){ let amount=Number(amountInput.value); if(!Number.isInteger(amount)||amount<1)amount=1; if(amount>30)amount=30; amountInput.value=amount; return amount; }

async function syncWallet(){
  try{
    const address = appKit.getAddress();
    const walletProvider = appKit.getWalletProvider();

    if(!address || !walletProvider){
      provider=null; signer=null; contract=null; account=null;
      walletEl.textContent = "not connected";
      return;
    }

    if(CONTRACT_ADDRESS === "PASTE_CONTRACT_ADDRESS_HERE") throw new Error("Встав адресу контракту в app.js");

    provider = new ethers.BrowserProvider(walletProvider);
    signer = await provider.getSigner();
    account = address;
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    walletEl.textContent = account.slice(0,6) + "..." + account.slice(-4);
    status("Connected");

    openseaLink.href = `https://opensea.io/collection/${CONTRACT_ADDRESS}`;
    etherscanLink.href = `https://etherscan.io/address/${CONTRACT_ADDRESS}`;
    await loadProgress();
    await refreshPrice();
  }catch(e){
    console.error(e);
    status("Error: " + (e.shortMessage || e.message));
  }
}

appKit.subscribeAccount(syncWallet);
appKit.subscribeProvider(syncWallet);
setTimeout(syncWallet, 800);

async function refreshPrice(){
  try{
    const amount = BigInt(getAmount());

    if(contract && account){
      cachedAlreadyMinted = await contract.minted(account);
      cachedPriceWei = await contract.PRICE();
    }

    if(!cachedPriceWei){
      priceText.textContent = amount === 1n ? "FREE" : (Number(amount-1n)*Number(DEFAULT_PRICE_ETH)).toFixed(4).replace(/0+$/,'').replace(/\.$/,'') + " ETH";
      return;
    }

    let paidAmount = amount;
    if(cachedAlreadyMinted === 0n) paidAmount = paidAmount > 0n ? paidAmount - 1n : 0n;
    priceText.textContent = paidAmount === 0n ? "FREE" : ethers.formatEther(cachedPriceWei * paidAmount) + " ETH";
  }catch(e){ console.error(e); }
}

async function loadProgress(){
  try{
    if(!contract) return;
    const minted = Number(await contract.totalSupply());
    mintedText.textContent = minted + " / " + MAX_SUPPLY;
    progressBar.style.width = Math.min(100, minted / MAX_SUPPLY * 100) + "%";
  }catch(e){ console.error(e); }
}

async function mint(){
  try{
    await syncWallet();
    if(!contract){ status("Connect wallet first"); return; }

    const amount = getAmount();
    const alreadyMinted = await contract.minted(account);
    const price = await contract.PRICE();

    let paidAmount = BigInt(amount);
    if(alreadyMinted === 0n) paidAmount = paidAmount > 0n ? paidAmount - 1n : 0n;

    const value = price * paidAmount;

    status("Confirm mint in wallet...");
    const tx = await contract.mint(amount, { value });
    status("Transaction sent: " + tx.hash);
    await tx.wait();
    status("Mint success!");
    await loadProgress();
    await refreshPrice();
    await loadGallery();
  }catch(e){
    console.error(e);
    status("Error: " + (e.shortMessage || e.message));
  }
}

async function loadGallery(){
  try{
    await syncWallet();
    if(!contract){ status("Connect wallet first"); return; }

    galleryEl.innerHTML = "<p class='galleryNote'>Loading minted NFTs...</p>";
    const supply = Number(await contract.totalSupply());

    if(supply === 0){
      galleryEl.innerHTML = "<p class='galleryNote'>No minted NFTs yet.</p>";
      return;
    }

    const start = Math.max(0, supply - 20);
    const ids = [];
    for(let i=supply-1; i>=start; i--) ids.push(i);

    const cards = await Promise.all(ids.map(async(id)=>{
      try{
        const uri = await contract.tokenURI(id);
        const meta = await (await fetch(ipfsToHttp(uri))).json();
        const img = ipfsToHttp(meta.image);
        const name = meta.name || ("AsciiPunk #" + id);
        return `<article class="nftCard"><img src="${img}" alt="${name}"><div>${name}<small>Token #${id}</small></div></article>`;
      }catch(e){
        console.error(e);
        return `<article class="nftCard"><div>Token #${id}<small>Metadata loading...</small></div></article>`;
      }
    }));

    galleryEl.innerHTML = cards.join("");
  }catch(e){
    console.error(e);
    galleryEl.innerHTML = "<p class='galleryNote'>Gallery error: " + (e.shortMessage || e.message) + "</p>";
  }
}

document.getElementById("mintBtn").onclick = mint;
document.getElementById("loadGalleryBtn").onclick = loadGallery;
document.getElementById("minusBtn").onclick = async()=>{ amountInput.value=Math.max(1,Number(amountInput.value||1)-1); await refreshPrice(); };
document.getElementById("plusBtn").onclick = async()=>{ amountInput.value=Math.min(30,Number(amountInput.value||1)+1); await refreshPrice(); };
amountInput.oninput = refreshPrice;
refreshPrice();

document.querySelectorAll(".thumbs img").forEach(img=>{
  img.onclick=()=>{
    document.getElementById("mainImg").src=img.dataset.img;
    document.querySelectorAll(".thumbs img").forEach(x=>x.classList.remove("active"));
    img.classList.add("active");
  };
});
