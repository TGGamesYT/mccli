import path from 'path';
import inquirer from 'inquirer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mlc from 'minecraft-launcher-core';
const { Authenticator, Client } = mlc;
import pkg from 'prismarine-auth';
const { Authflow } = pkg;
import fs from 'fs-extra';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { mouse, keyboard, Button, Key } from '@nut-tree-fork/nut-js';
import activeWin from 'active-win';
import screenshot from 'screenshot-desktop';
import { createRequire } from 'module';
import axios from 'axios';
import child_process from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INSTANCES_DIR = path.join(__dirname, 'instances');
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const ACCOUNTS_PATH = path.join(__dirname, 'accounts.json');
const AUTH_CACHE = path.resolve('./.auth_cache');
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const launcher = new Client();

async function stream(port, allowInteractions) {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });
  
    app.get('/', (_, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Stream</title></head>
        <body style="margin:0;overflow:hidden;background:black;">
          <canvas id="screen"></canvas>
          <script>
            const canvas = document.getElementById('screen');
            const ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
  
            const ws = new WebSocket("ws://" + location.host);
            ws.binaryType = "arraybuffer";
  
            ws.onmessage = e => {
              const blob = new Blob([e.data], { type: 'image/jpeg' });
              const url = URL.createObjectURL(blob);
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
              };
              img.src = url;
            };
  
            document.addEventListener('click', e => {
              const rect = canvas.getBoundingClientRect();
              const x = (e.clientX / canvas.width);
              const y = (e.clientY / canvas.height);
              ws.send(JSON.stringify({ type: 'mouse', x, y, click: 'left' }));
            });
  
            document.addEventListener('keydown', e => {
              ws.send(JSON.stringify({ type: 'key', key: e.key }));
            });
          </script>
        </body>
        </html>
      `);
    });
  
    wss.on('connection', async ws => {
      console.log('Client connected. Waiting for Minecraft...');
  
      const bounds = await waitForMinecraftWindow(10000);
      if (!bounds) {
        console.log('Minecraft window not found.');
        ws.close();
        return;
      }
  
      console.log('Minecraft window found:', bounds);
  
      let running = true;
  
      const sendLoop = async () => {
        while (running && ws.readyState === ws.OPEN) {
          try {
            // Take a screenshot (Buffer) of the screen
            const img = await screenshot({ format: 'png' });
  
            // Crop the image buffer to Minecraft window using raw pixel manipulation
            const croppedImage = await cropImageBuffer(img, bounds.x, bounds.y, bounds.width, bounds.height);
  
            // Send the cropped image as JPEG to the client
            ws.send(croppedImage);
          } catch (e) {
            console.error('Capture error:', e.message);
          }
  
          // Sleep for ~100ms to simulate ~10fps
          await new Promise(r => setTimeout(r, 100));
        }
      };
  
      sendLoop();
  
      ws.on('close', () => {
        running = false;
      });
  
      if (allowInteractions) {
        ws.on('message', async msg => {
          try {
            const data = JSON.parse(msg);
            const absX = bounds.x + Math.floor(data.x * bounds.width);
            const absY = bounds.y + Math.floor(data.y * bounds.height);
  
            if (data.type === 'mouse') {
              await mouse.setPosition({ x: absX, y: absY });
              if (data.click === 'left') await mouse.click(Button.LEFT);
            }
  
            if (data.type === 'key') {
              const key = Key[data.key.toUpperCase()];
              if (key) {
                await keyboard.pressKey(key);
                await keyboard.releaseKey(key);
              }
            }
          } catch (e) {
            console.error('Interaction error:', e.message);
          }
        });
      }
    });
  
    server.listen(port, () => {
      console.log(`Minecraft stream available at http://localhost:${port}`);
    });
  }
  
  async function waitForMinecraftWindow(timeoutMs) {
    const end = Date.now() + timeoutMs;
  
    while (Date.now() < end) {
      const win = await activeWin();
      if (win && win.title.toLowerCase().includes('minecraft')) {
        return win.bounds;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  
    return null;
  }
  
  // Crop image buffer function
  const cropImageBuffer = (buffer, x, y, width, height) => {
    return new Promise((resolve, reject) => {
      const sharp = require('sharp');
  
      // Validate the crop dimensions and coordinates
      if (x < 0 || y < 0 || width <= 0 || height <= 0) {
        return reject(new Error('Invalid crop area dimensions.'));
      }
  
      sharp(buffer)
        .metadata()
        .then(metadata => {
          console.log('Image Metadata:', metadata);
  
          // Ensure the crop area is within image bounds
          if (x + width > metadata.width) {
            console.log(`Adjusted crop width: ${x + width} exceeds image width. Reducing width.`);
            width = metadata.width - x; // Adjust width to fit the image width
          }
  
          if (y + height > metadata.height) {
            console.log(`Adjusted crop height: ${y + height} exceeds image height. Reducing height.`);
            height = metadata.height - y; // Adjust height to fit the image height
          }
  
          // Proceed with cropping the image
          sharp(buffer)
            .extract({ left: x, top: y, width: width, height: height })
            .toBuffer()
            .then(croppedBuffer => {
              resolve(croppedBuffer);
            })
            .catch(err => {
              console.error('Sharp extraction error:', err);
              reject(err);
            });
        })
        .catch(err => {
          console.error('Sharp metadata error:', err);
          reject(err);
        });
    });
  };
  
  export { stream };  
 
  async function ensureInstancesDir() {
    try {
        // Check if the directory exists, if not, create it
        if (!fs.existsSync(INSTANCES_DIR)) {
            await fs.promises.mkdir(INSTANCES_DIR, { recursive: true });
        }

        // Check if the accounts file exists, if not, create it
        if (!fs.existsSync(ACCOUNTS_PATH)) {
            await fs.promises.writeFile(ACCOUNTS_PATH, JSON.stringify([]));
        }
    } catch (err) {
        console.error('Error ensuring instances directory:', err);
    }
}

export async function getAccount() {
    let accounts = [];
    try {
        accounts = JSON.parse(await fs.readFile(ACCOUNTS_FILE, 'utf8'));
    } catch {
        accounts = [];
    }

    const choices = ['Add New Account', ...accounts.map(a => `${a.username} (${a.type})`)];
    const { accountChoice } = await inquirer.prompt({
        type: 'list',
        name: 'accountChoice',
        message: 'Choose account:',
        choices
    });

    if (accountChoice === 'Add New Account') {
        const { accountType } = await inquirer.prompt({
            type: 'list',
            name: 'accountType',
            message: 'Select account type:',
            choices: ['Premium (Microsoft)', 'Cracked']
        });

        if (accountType === 'Cracked') {
            const { username } = await inquirer.prompt({
                type: 'input',
                name: 'username',
                message: 'Enter cracked username:'
            });

            const acc = {
                username,
                uuid: '00000000-0000-0000-0000-000000000000',
                access_token: 'cracked',
                type: 'cracked'
            };

            accounts.push(acc);
            await fs.writeJson(ACCOUNTS_FILE, accounts, { spaces: 2 });
            return acc;
        } else {
            try {
                const { username } = await inquirer.prompt({
                    type: 'input',
                    name: 'username',
                    message: 'Enter any name to identify your Minecraft login session:'
                });

                // Initialize the Authflow for Minecraft Java Edition authentication
                const flow = new Authflow(username, AUTH_CACHE);

                // Get the Minecraft Java Edition auth token
                const result = await flow.getMinecraftJavaToken({ fetchProfile: true });
                console.log('result: ${result}')
                // Ensure the access token and profile are available
                const acc = {
                    username: result.profile.name,
                    uuid: result.profile.id,
                    access_token: result.token || '', 
                    type: 'msa', 
                    meta: {
                      xuid: result.xuid,
                      expires: result.expires
                    }
                  };
                  

                console.log('Authentication successful.');

                accounts.push(acc);
                await fs.writeJson(ACCOUNTS_FILE, accounts, { spaces: 2 });

                // Return the account object with access token
                return acc;
            } catch (err) {
                console.error('Minecraft authentication failed:', err.message || err);
                return null;
            }
        }
    } else {
        const index = accounts.findIndex(a => `${a.username} (${a.type})` === accountChoice);
        return accounts[index];
    }
}





async function mainMenu() {
    await ensureInstancesDir();
    const choices = ['Create New Instance', 'Launch Existing Instance', 'Download Modloader to an Existing Instance', 'Exit'];
    const { action } = await inquirer.prompt({
        type: 'list',
        name: 'action',
        message: 'Main Menu',
        choices
    });

    if (action === choices[0]) {
        return createInstanceMenu();
    } else if (action === choices[1]) {
        return launchInstanceMenu();
    } else if (action == choices[2]) {
        return modloader();
    } else {
        process.exit(0);
    }
}
async function modloader() {
  const instanceDirs = await fs.promises.readdir(INSTANCES_DIR);
  const { instance } = await inquirer.prompt({
    type: 'list',
    name: 'instance',
    message: 'Select your instance:',
    choices: ['← Back', ...instanceDirs]
  })
  if (instance === '← Back') return mainMenu();
  const { modLoader } = await inquirer.prompt({
    type: 'list',
    name: 'modLoader',
    message: 'Select a mod loader:',
    choices: ['Vanilla', 'Fabric', 'Forge']
  });
  console.log(modLoader)
  await installModLoader(instance, modLoader, `instances/${instance}`);
}

async function fetchVersions() {
  const { data } = await axios.get(MANIFEST_URL);
  return data.versions;
}

async function createInstanceMenu() {
  const versions = await fetchVersions();

  const choices = [
    { name: '← Back', value: null },
    ...versions.map(v => ({
        name: `${v.id} (${v.type})`,
        value: v
    }))
];

  const { version } = await inquirer.prompt({
      type: 'list',
      name: 'version',
      message: 'Select Minecraft version to create instance:',
      choices
  });

  if (!version) return mainMenu();

  const instancePath = path.join(INSTANCES_DIR, version.id);
  if (await fs.pathExists(instancePath)) {
      console.log(`Instance for ${version.id} already exists.`);
  } else {
      await fs.ensureDir(instancePath);
      await fs.writeJson(path.join(instancePath, 'instance.json'), {
          version: version.id,
          type: version.type
      });
      console.log(`Created instance for ${version.id}.`);
  }

  return mainMenu();
}

async function launchInstanceMenu() {
  try {
      const instanceDirs = await fs.promises.readdir(INSTANCES_DIR);
      if (instanceDirs.length === 0) {
          console.log('No instances found.');
          return mainMenu();
      }

      const choices = ['← Back', ...instanceDirs];
      const { selected } = await inquirer.prompt({
          type: 'list',
          name: 'selected',
          message: 'Select instance to launch:',
          choices
      });

      if (selected === '← Back') return mainMenu();

      const instancePath = path.join(INSTANCES_DIR, selected);
      const configPath = path.join(instancePath, 'instance.json');
      
      // Read and parse the JSON file
      let config = await fs.promises.readFile(configPath, 'utf8');
      config = JSON.parse(config); // Parse the JSON content

      const account = await getAccount(); // Make sure this function is defined

      const { doStream } = await inquirer.prompt({
          type: 'confirm',
          name: 'doStream',
          message: 'Do you want to stream the instance?'
      });

      if (doStream) {
          const { port, allowInteraction } = await inquirer.prompt([{
              type: 'input',
              name: 'port',
              message: 'Enter port number:',
              default: '3000'
          }, {
              type: 'confirm',
              name: 'allowInteraction',
              message: 'Allow interactions?'
          }]);
          stream(port, allowInteraction);
      }

      // Initialize options for launching the instance
      const opts = {
          authorization: {
              access_token: account.access_token,
              name: account.username,
              uuid: account.uuid,
              user_properties: '{}',
              meta: { type: account.type }
          },
          root: instancePath,
          version: {
              number: config.version,
              type: config.type
          },
          memory: {
              max: '2G',
              min: '1G'
          }
      };

      // Check if this instance uses a modloader (Fabric or Forge)
      const modloaderType = config.modloader || null;

      if (modloaderType) {
          console.log(`${modloaderType} mod loader detected, but this wasnt fully implemented yet.`);

          // You can use your modloader download logic here for Fabric or Forge
          if (modloaderType === 'fabric') {
              // Handle Fabric modloader (ensure the necessary files are in place)
              const fabricJsonPath = path.join(instancePath, 'versions', config.version, `${config.version}-fabric.json`);
              const fabricJson = JSON.parse(await fs.promises.readFile(fabricJsonPath, 'utf8'));

              // Prepare Fabric libraries for classpath
              let classpath = [];
              fabricJson.libraries.forEach(library => {
                  if (library.url) {
                      classpath.push(path.join(instancePath, 'libraries', library.name.replace(':', path.sep) + '.jar'));
                  }
              });

              // Add base Minecraft JAR to the classpath
              classpath.push(path.join(instancePath, 'versions', config.version, `${config.version}.jar`));

              // Add classpath to opts (or another specific field if necessary)
              opts.classpath = classpath.join(path.delimiter);

          } else if (modloaderType === 'forge') {
              // Handle Forge modloader logic here (similar to Fabric)
              const forgeJsonPath = path.join(instancePath, 'versions', config.version, `${config.version}-forge.json`);
              const forgeJson = JSON.parse(await fs.promises.readFile(forgeJsonPath, 'utf8'));

              let classpath = [];
              forgeJson.libraries.forEach(library => {
                  if (library.url) {
                      classpath.push(path.join(instancePath, 'libraries', library.name.replace(':', path.sep) + '.jar'));
                  }
              });

              classpath.push(path.join(instancePath, 'versions', config.version, `${config.version}.jar`));

              opts.classpath = classpath.join(path.delimiter);
          }
      }

      console.log(`Launching ${config.version} as ${account.username}...`);
      launcher.launch(opts);

      launcher.on('data', (e) => process.stdout.write(e.toString()));
      launcher.on('close', () => {
          console.log('Minecraft closed.');
          mainMenu();
      });
  } catch (err) {
      console.error('Error launching instance:', err);
      mainMenu();
  }
}
async function installModLoader(version, modLoader, instancePath) {
  console.log("THIS IS NOT FULLY IMPLEMENTED YET")
  const loaderInstallerDir = path.join(__dirname, 'modloader_installers');
  await fs.ensureDir(loaderInstallerDir);

  try {
    const instanceJsonPath = path.join(instancePath, 'instance.json');
    
    // Read the instance.json file
    const config = await fs.promises.readFile(instanceJsonPath, 'utf8');
    const configJson = JSON.parse(config);

    // Add the modloader information to instance.json
    configJson.modloader = modLoader;

    // Save the updated JSON back to the file
    await fs.promises.writeFile(instanceJsonPath, JSON.stringify(configJson, null, 2));
  } catch (err) {
    console.error(`Error adding modloader to instance ${instancePath}:`, err);
    return mainMenu();
  }

  if (modLoader === 'Fabric') {
    const fabricInstaller = path.join(loaderInstallerDir, 'fabric-installer.jar');
    
    if (!fs.existsSync(fabricInstaller)) {
      const url = 'https://meta.fabricmc.net/v2/versions/installer';
      const { data } = await axios.get(url);
      const latest = data[0];
      const installerUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${latest.version}/fabric-installer-${latest.version}.jar`;
      const writer = fs.createWriteStream(fabricInstaller);
      const response = await axios.get(installerUrl, { responseType: 'stream' });
      response.data.pipe(writer);
      await new Promise((res, rej) => {
        writer.on('finish', res);
        writer.on('error', rej);
      });
    }

    const javaArgs = [
      '-jar', fabricInstaller,
      'client',
      '-dir', instancePath,
      '-mcversion', version,
      '-noprofile'
    ];

    try {
      await new Promise((resolve, reject) => {
        const proc = child_process.spawnSync('java', javaArgs, { stdio: 'inherit' });
  
        if (proc.error) {
          reject(new Error(`Fabric installer failed: ${proc.error.message}`));
        } else {
          resolve();
        }
      });

      console.log('✅ Fabric installed.');
    } catch (err) {
      console.error('❌ Failed to install Fabric:', err.message);
      return mainMenu(); // Return to main menu on failure
    }

  } else if (modLoader === 'Forge') {
    const forgeMetaUrl = `https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`;
    const { data } = await axios.get(forgeMetaUrl);
    const recommended = data.promos[`${version}-recommended`];
    if (!recommended) {
      console.log(`⚠️ No recommended Forge version for ${version}`);
      return mainMenu();
    }

    const forgeVersion = recommended;
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVersion}/forge-${version}-${forgeVersion}-installer.jar`;
    const forgeInstaller = path.join(loaderInstallerDir, `forge-installer-${version}.jar`);

    const writer = fs.createWriteStream(forgeInstaller);
    const response = await axios.get(installerUrl, { responseType: 'stream' });
    response.data.pipe(writer);
    await new Promise((res, rej) => {
      writer.on('finish', res);
      writer.on('error', rej);
    });

    const javaArgs = [
      '-jar', forgeInstaller,
      '--installServer'
    ];

    try {
      await new Promise((resolve, reject) => {
        const proc = child_process.spawnSync('java', javaArgs, {
          cwd: instancePath,
          stdio: 'inherit'
        });
        if (proc.error) {
          reject(new Error(`Forge installer failed: ${proc.error.message}`));
        } else {
          resolve();
        }
      });

      console.log('✅ Forge installed.');
    } catch (err) {
      console.error('❌ Failed to install Forge:', err.message);
      return mainMenu(); // Return to main menu on failure
    }
  } else {
    console.log('🔹 No mod loader selected; using vanilla.');
    return mainMenu();
  }
}

mainMenu();
