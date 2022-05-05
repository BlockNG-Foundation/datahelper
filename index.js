const { exec } = require('child_process');
const fs = require('fs-extra');
const BigNumber = require('bignumber.js');
const { ethers } = require('ethers');
const log4js = require('log4js');
const { exit } = require('process');

BigNumber.config({ EXPONENTIAL_AT: 1e9 });
const logger = log4js.getLogger();
logger.level = 'info';

// const PROVIDER_URL = 'https://smartbch.fountainhead.cash/mainnet';
const PROVIDER_URL = 'https://global.uat.cash';
const AGG_CONTRACT = {
  address: '0x99e858958e16c015f5b7B710D960498EEee76994',
  abi: [
    'function metaverseByIndex(address _market, address _level, uint256 _punkStart, uint256 _punkEnd) view returns (tuple(uint256 tokenId, address owner, string ownerSlogan, string punkSlogan)[] sounds, tuple(uint256 punkId, uint256 level, uint256 baseScore, uint256 wanderScore, uint256 outlawScore, uint256 totalScore)[] infos, uint256[] lockTimes)'
  ]
};
const UTIL_CONTRACT = {
  address: '0xA0DB7a4D305407a9069612bdcb98AC4e75D3a556',
  abi: [
    'function tokensOfMarketByPage(address _market, address _lawpunks, uint256 _pageNo, uint256 _pageSize) view returns (tuple(uint256 id, bool isForSale, address seller, uint256 minValue, uint256 minLawValue, uint256 bidLawValue, address bidder, address onlySellTo, uint256 bidBchValue, address bchBidder)[] rets)'
  ]
};
const PUNK_CONTRACT = {
  address: '0xff48aAbDDACdc8A6263A2eBC6C1A68d8c46b1bf7',
  abi: ['function balanceOf(address _owner) view returns (uint256)']
};
const DEX_CONTRACT = {
  address: '0xc062bf9FaBE930FF8061f72b908AB1b702b3FdD6',
  abi: []
};
const LEVEL_CONTRACT = {
  address: '0x9E9eACB7E5dCc374d3108598054787ccae967544',
  abi: []
};
const STAKE_CONTRACT = {
  address: '0xbeAAe3E87Bf71C97e458e2b9C84467bdc3b871c6',
  abi: ['function totalSupply() view returns (uint256)']
};



const METAVERSE_PATH = './metaverse.json';
const STAKING_INFO_PATH = './stakingInfo.json';
const RELOAD_TIME = 3 * 60 * 1000;
let globalMetaverseData = [[0, 0, 0, 0, 0, '', '', '', 0]];
let globalMarketData = {};
let globalStakingData = {};
let globalSuccess = false;

const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
const aggContract = new ethers.Contract(AGG_CONTRACT.address, AGG_CONTRACT.abi, provider);
const utilContract = new ethers.Contract(UTIL_CONTRACT.address, UTIL_CONTRACT.abi, provider);
const punkContract = new ethers.Contract(PUNK_CONTRACT.address, PUNK_CONTRACT.abi, provider);
const stakeContract = new ethers.Contract(STAKE_CONTRACT.address, STAKE_CONTRACT.abi, provider);

const readData = () => {
  if (fs.existsSync(METAVERSE_PATH)) {
    const dataStr = fs.readFileSync(METAVERSE_PATH, 'utf-8');
    try {
      globalMetaverseData = JSON.parse(dataStr);
    } catch (error) {
      logger.error(`[readData] [METAVERSE] Error: ${error}`);
    }
  }

  if (fs.existsSync(STAKING_INFO_PATH)) {
    const dataStr = fs.readFileSync(STAKING_INFO_PATH, 'utf-8');
    try {
      globalStakingData = JSON.parse(dataStr);
    } catch (error) {
      logger.error(`[readData] [STAKING] Error: ${error}`);
    }
  }
};

const checkData = async () => {
  globalSuccess = false;

  const MAX_TOKENID = 10000;
  const PAGE_SIZE = 30;
  const PAGE_COUNT = Math.ceil(MAX_TOKENID / PAGE_SIZE);
  const callFuncArgs = [];

  const MAX_POOL = 5;
  const POOL_COUNT = Math.ceil(PAGE_COUNT / MAX_POOL);

  for (let index = 0; index < PAGE_COUNT; index++) {
    const tokenStart = index * PAGE_SIZE + 1;
    const tokenEnd = (index + 1) * PAGE_SIZE > MAX_TOKENID ? MAX_TOKENID : (index + 1) * PAGE_SIZE;
    callFuncArgs.push([tokenStart, tokenEnd]);
  }

  const startTime = Date.now();
  try {
    for (let index = 0; index < POOL_COUNT; index++) {
      await Promise.all(callFuncArgs.slice(index * MAX_POOL, (index + 1) * MAX_POOL).map(_ => setMetaverseData(..._)));
    }

    globalSuccess = true;
    logger.info(`[checkData] [METAVERSE] Success ${Math.ceil((Date.now() - startTime) / 1000)}s`);
  } catch (error) {
    globalSuccess = false;
    logger.error(`[checkData] [METAVERSE] Error: ${error}`);
  }

  // MARKET & STAKING INFO
  if (globalSuccess) {
    await checkStakingDate();
  }

  if (globalSuccess) {
    writeData();
  }

  setTimeout(() => {
    checkData();
  }, RELOAD_TIME);
};

const checkStakingDate = async () => {
  globalMarketData = {};
  const startTime = Date.now();
  try {
    // MARKET INFO
    const count = await punkContract.balanceOf(DEX_CONTRACT.address);

    const PAGE_SIZE = 100;
    const PAGE_COUNT = Math.ceil(count.toNumber() / PAGE_SIZE);
    const MAX_POOL = 5;
    const POOL_COUNT = Math.ceil(PAGE_COUNT / MAX_POOL);
    const dexFuncArgs = [];

    for (let index = 0; index < PAGE_COUNT; index++) {
      dexFuncArgs.push([index, PAGE_SIZE]);
    }

    for (let index = 0; index < POOL_COUNT; index++) {
      await Promise.all(dexFuncArgs.slice(index * MAX_POOL, (index + 1) * MAX_POOL).map(_ => setMarketDate(..._)));
    }
    logger.info(`[checkData] [MARKET] Success ${Math.ceil((Date.now() - startTime) / 1000)}s`);

    // STAKING INFO
    await setStakingDate();
  } catch (error) {
    globalSuccess = false;
    logger.error(`[checkData] [STAKING] Error: ${error}`);
  }
};

const setMetaverseData = async (tokenStart, tokenEnd) => {
  try {
    const { sounds, infos, lockTimes } = await aggContract.metaverseByIndex(
      DEX_CONTRACT.address,
      LEVEL_CONTRACT.address,
      tokenStart,
      tokenEnd
    );

    sounds.forEach((_, i) => {
      const tokenId = _.tokenId.toNumber();
      globalMetaverseData[tokenId] = [
        infos[i].level.toNumber(),
        infos[i].baseScore.toNumber(),
        infos[i].wanderScore.toNumber(),
        infos[i].outlawScore.toNumber(),
        infos[i].totalScore.toNumber(),
        _.owner,
        _.ownerSlogan,
        _.punkSlogan,
        lockTimes[i].toNumber()
      ];
    });
  } catch (error) {
    logger.error(`[setData] [METAVERSE] Error: ${tokenStart} - ${tokenEnd} | ${error}`);
    throw error;
  }
};

const setMarketDate = async (_pageNo, _pageSize) => {
  try {
    const result = await utilContract.tokensOfMarketByPage(
      DEX_CONTRACT.address,
      PUNK_CONTRACT.address,
      _pageNo,
      _pageSize
    );

    result.forEach(_ => {
      const { id, minValue, minLawValue } = _;
      globalMarketData[id.toNumber()] = { bch: new BigNumber(minValue._hex), law: new BigNumber(minLawValue._hex) };
    });
  } catch (error) {
    logger.error(`[setData] [MARKET] Error: ${_pageNo} - ${_pageSize} | ${error}`);
    throw error;
  }
};

const setStakingDate = async () => {
  globalStakingData = {};
  const startTime = Date.now();
  try {
    // MARKET
    let bchFloor = new BigNumber(0);
    let lawFloor = new BigNumber(0);
    Object.values(globalMarketData).forEach(_ => {
      const { bch, law } = _;
      if (bch.gt(0)) {
        if (bchFloor.eq(0) || bchFloor.gt(bch)) {
          bchFloor = bch;
        }
      }
      if (law.gt(0)) {
        if (lawFloor.eq(0) || lawFloor.gt(law)) {
          lawFloor = law;
        }
      }
    });

    // HASH RATE
    const HASH_PRECISION = 1e8;
    const LAWPUNK_TOTALSUPPLY = 10000;
    let totalHashRate = new BigNumber(0);
    Object.values(globalMetaverseData).forEach(_ => {
      const totalScore = _[4];
      totalHashRate = totalHashRate.plus(new BigNumber(totalScore).div(HASH_PRECISION).sqrt());
    });

    const totalHashRateStaked = await stakeContract.totalSupply();

    globalStakingData.bchFloor = bchFloor.toString();
    globalStakingData.lawFloor = lawFloor.toString();
    globalStakingData.totalHashRate = totalHashRate.times(HASH_PRECISION).integerValue(BigNumber.ROUND_DOWN).toString();
    globalStakingData.totalHashRateStaked = totalHashRateStaked.toString();
    globalStakingData.totalPunkValueLockedInBch = new BigNumber(globalStakingData.totalHashRateStaked)
      .div(HASH_PRECISION)
      .div(totalHashRate)
      .times(bchFloor)
      .times(LAWPUNK_TOTALSUPPLY)
      .integerValue(BigNumber.ROUND_DOWN)
      .toString();

    logger.info(`[setData] [STAKING] Success ${Math.ceil((Date.now() - startTime) / 1000)}s`);
  } catch (error) {
    globalSuccess = false;
    logger.error(`[setData] [STAKING] Error: ${error}`);
  }
};

const writeData = async () => {
  const curData = JSON.stringify(globalMetaverseData);
  let lastData = '';
  if (fs.existsSync(METAVERSE_PATH)) {
    lastData = fs.readFileSync(METAVERSE_PATH, 'utf-8');
  }

  const curStaking = JSON.stringify(globalStakingData);
  let lastStaking = '';
  if (fs.existsSync(STAKING_INFO_PATH)) {
    lastStaking = fs.readFileSync(STAKING_INFO_PATH, 'utf-8');
    if (curStaking == lastStaking);
  }
  if (curData == lastData && curStaking == lastStaking) return;

  fs.writeFileSync(METAVERSE_PATH, curData);
  fs.writeFileSync(STAKING_INFO_PATH, curStaking);

};

logger.info('Start watching');

readData();
checkData();
