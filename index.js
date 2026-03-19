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

// Mapping of target names to pkgarch for new OpenWRT format (25.12.0+)
const targetToPkgArch = {
  'apm821xx': 'ppc44x',
  'armsr': 'arm',
  'at91': 'arm',
  'ath79': 'mips',
  'bcm27xx': 'aarch72',
  'bcm47xx': 'mips',
  'bcm4908': 'aarch72',
  'bcm53xx': 'arm',
  'bmips': 'mips',
  'd1': 'riscv',
  'gemini': 'arm',
  'imx': 'aarch72',
  'ipq40xx': 'aarch72',
  'ipq806x': 'aarch72',
  'ixp4xx': 'arm',
  'kirkwood': 'arm',
  'lantiq': 'mips',
  'layerscape': 'aarch72',
  'loongarch64': 'loongarch',
  'malta': 'mips',
  'mediatek': 'aarch72',
  'microchipsw': 'riscv',
  'mpc85xx': 'ppce500',
  'mvebu': 'aarch72',
  'mxs': 'arm',
  'octeon': 'mips64',
  'omap': 'arm',
  'pistachio': 'mips',
  'qoriq': 'ppce500',
  'qualcommax': 'aarch72',
  'ramips': 'mips',
  'realtek': 'arm',
  'rockchip': 'aarch72',
  'sifiveu': 'riscv',
  'siflower': 'mips',
  'starfive': 'riscv',
  'stm32': 'aarch72',
  'sunxi': 'arm',
  'tegra': 'aarch72',
  'x86': 'x86_64',
  'zynq': 'arm'
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

  // If pkgarch not found in filename (new format), derive from target
  if (!pkgarch) {
    pkgarch = targetToPkgArch[target] || target;
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