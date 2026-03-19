const axios = require('axios');
const cheerio = require('cheerio');
const core = require('@actions/core');

const version = process.argv[2];
const filterTargetsStr = process.argv[3] || '';
const filterSubtargetsStr = process.argv[4] || '';

const filterTargets = filterTargetsStr ? filterTargetsStr.split(',').map(t => t.trim()).filter(t => t) : [];
const filterSubtargets = filterSubtargetsStr ? filterSubtargetsStr.split(',').map(s => s.trim()).filter(s => s) : [];

if (!version) {
  core.setFailed('Version argument is required');
  process.exit(1);
}

const MIRRORS = [
  'https://downloads.openwrt.org',
  'https://mirror-03.infra.openwrt.org',
  'https://archive.openwrt.org'
];

let baseUrl = '';
let releasesUrl = '';

async function fetchHTML(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      return cheerio.load(data);
    } catch (error) {
      console.error(`Attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }
  return null;
}

async function getItems(url) {
  const $ = await fetchHTML(url);
  if (!$) return [];
  const items = [];
  $('table tr td.n a').each((_, el) => {
    const name = $(el).attr('href');
    // Filter: must end with /, not be ../ or parent directory links
    if (name && name.endsWith('/') && !name.startsWith('/') && name !== '../') {
      items.push(name.slice(0, -1));
    }
  });
  return items;
}

async function getTargets() {
  for (const mirror of MIRRORS) {
    const url = `${mirror}/releases/${version}/targets/`;
    const items = await getItems(url);
    if (items.length > 0) {
      baseUrl = mirror;
      releasesUrl = `/releases/${version}/targets/`;
      return items;
    }
  }
  return [];
}

// Mapping of target/subtarget to pkgarch for new OpenWRT format (25.12.0+)
const targetSubtargetToPkgArch = {
  'apm821xx/nand': 'ppc44x',
  'apm821xx/sata': 'ppc44x',
  'armsr/armv7': 'arm',
  'armsr/armv8': 'aarch64',
  'at91/sam9x': 'arm',
  'at91/sama5': 'arm',
  'at91/sama7': 'arm',
  'ath79/generic': 'mips_24kc',
  'ath79/mikrotik': 'mips_24kc',
  'ath79/nand': 'mips_24kc',
  'ath79/tiny': 'mips_24kc',
  'bcm27xx/bcm2708': 'arm',
  'bcm27xx/bcm2709': 'arm',
  'bcm27xx/bcm2710': 'aarch64',
  'bcm27xx/bcm2711': 'aarch64',
  'bcm27xx/bcm2712': 'aarch64',
  'bcm47xx/generic': 'mips',
  'bcm47xx/legacy': 'mips',
  'bcm47xx/mips74k': 'mips',
  'bcm4908/generic': 'aarch64',
  'bcm53xx/generic': 'arm',
  'bmips/bcm6318': 'mips',
  'bmips/bcm63268': 'mips',
  'bmips/bcm6328': 'mips',
  'bmips/bcm6358': 'mips',
  'bmips/bcm6362': 'mips',
  'bmips/bcm6368': 'mips',
  'd1/generic': 'riscv',
  'gemini/generic': 'arm',
  'imx/cortexa53': 'aarch64',
  'imx/cortexa7': 'arm',
  'imx/cortexa9': 'arm',
  'ipq40xx/chromium': 'aarch64',
  'ipq40xx/generic': 'aarch64',
  'ipq40xx/mikrotik': 'aarch64',
  'ipq806x/chromium': 'aarch64',
  'ipq806x/generic': 'aarch64',
  'ixp4xx/generic': 'arm',
  'kirkwood/generic': 'arm',
  'lantiq/xrx200': 'mips',
  'lantiq/xrx200_legacy': 'mips',
  'lantiq/xway': 'mips',
  'layerscape/armv7': 'arm',
  'layerscape/armv8_64b': 'aarch64',
  'loongarch64/generic': 'loongarch',
  'malta/be': 'mips',
  'malta/be64': 'mips64',
  'malta/le': 'mips',
  'malta/le64': 'mips64',
  'mediatek/filogic': 'aarch64',
  'mediatek/mt7622': 'aarch64',
  'mediatek/mt7623': 'arm',
  'mediatek/mt7629': 'aarch64',
  'microchipsw/lan969x': 'riscv',
  'mpc85xx/p1010': 'ppce500',
  'mpc85xx/p1020': 'ppce500',
  'mpc85xx/p2020': 'ppce500',
  'mvebu/cortexa53': 'aarch64',
  'mvebu/cortexa72': 'aarch64',
  'mvebu/cortexa9': 'arm',
  'mxs/generic': 'arm',
  'octeon/generic': 'mips64',
  'omap/generic': 'arm',
  'pistachio/generic': 'mips',
  'qoriq/generic': 'ppce500',
  'qualcommax/ipq50xx': 'aarch64',
  'qualcommax/ipq60xx': 'aarch64',
  'qualcommax/ipq807x': 'aarch64',
  'ramips/mt7620': 'mips',
  'ramips/mt7621': 'mips',
  'ramips/mt76x8': 'mips',
  'ramips/rt305x': 'mips',
  'ramips/rt3883': 'mips',
  'realtek/rtl838x': 'arm',
  'realtek/rtl839x': 'arm',
  'realtek/rtl930x': 'arm',
  'realtek/rtl930x_nand': 'arm',
  'realtek/rtl931x': 'arm',
  'realtek/rtl931x_nand': 'arm',
  'rockchip/armv8': 'aarch64',
  'sifiveu/generic': 'riscv',
  'siflower/sf21': 'mips',
  'starfive/generic': 'riscv',
  'stm32/stm32mp1': 'aarch64',
  'sunxi/arm926ejs': 'arm',
  'sunxi/cortexa53': 'aarch64',
  'sunxi/cortexa7': 'arm',
  'sunxi/cortexa8': 'arm',
  'tegra/generic': 'aarch64',
  'x86/64': 'x86_64',
  'x86/generic': 'x86_64',
  'x86/geode': 'i386_pentium-mmx',
  'x86/legacy': 'i386_pentium-mmx',
  'zynq/generic': 'arm'
};

async function getDetails(target, subtarget) {
  const packagesUrl = `${baseUrl}${releasesUrl}${target}/${subtarget}/packages/`;
  const $ = await fetchHTML(packagesUrl);
  if (!$) return { vermagic: '', pkgarch: '' };

  let vermagic = '';
  let pkgarch = '';

  $('a').each((_, el) => {
    const name = $(el).attr('href');
    if (name && name.startsWith('kernel')) {
      // New format: kernel-6.12.71~364f8debbcd4cddc1f038dea515bf8a5-r1.apk
      const matchNew = name.match(/kernel-[\d.]+~([a-f0-9]+)-r\d+\.(?:ipk|apk)$/);
      // Old format: kernel_5.15.160-1~abcdef123_mips_24kc.ipk
      const matchOld = name.match(/kernel_[\d.]+[-~]([a-f0-9]+)[-_]([a-zA-Z0-9_-]+)\.(?:ipk|apk)$/);
      
      if (matchNew) {
        vermagic = matchNew[1];
      } else if (matchOld) {
        vermagic = matchOld[1];
        pkgarch = matchOld[2];
      }
    }
  });

  // If pkgarch not found in filename (new format), derive from target/subtarget
  if (!pkgarch) {
    const key = `${target}/${subtarget}`;
    pkgarch = targetSubtargetToPkgArch[key] || target;
  }

  return { vermagic, pkgarch };
}

async function main() {
  try {
    const targets = await getTargets();
    if (targets.length === 0) {
      core.setFailed(`No targets found for version ${version}. Check if version exists.`);
      return;
    }

    const jobConfig = [];

    for (const target of targets) {
      if (filterTargets.length > 0 && !filterTargets.includes(target)) continue;

      const subtargets = await getItems(`${baseUrl}${releasesUrl}${target}/`);

      for (const subtarget of subtargets) {
        if (filterSubtargets.length > 0 && !filterSubtargets.includes(subtarget)) continue;

        console.log(`Processing: ${target}/${subtarget}`);
        const { vermagic, pkgarch } = await getDetails(target, subtarget);

        if (pkgarch) {
          jobConfig.push({
            tag: version,
            target,
            subtarget,
            vermagic,
            pkgarch,
          });
        }
      }
    }

    if (jobConfig.length === 0) {
      core.setFailed("No targets found to build. Check your filters.");
    } else {
      console.log(`Total jobs generated: ${jobConfig.length}`);
      core.setOutput('job-config', JSON.stringify(jobConfig));
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();