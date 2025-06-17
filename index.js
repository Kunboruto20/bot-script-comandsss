// Import the complete package and destructure what you need
import pkg from '@borutowaileys/library';
const { makeWASocket, useMultiFileAuthState, downloadMediaMessage } = pkg;
const DisconnectReason = pkg.DisconnectReason;

import Pino from "pino";
import fs from "fs";
import readline from "readline";
import process from "process";
import dns from "dns";
import chalk from "chalk";
import qrcode from "qrcode-terminal";

// Helper for delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Function to normalize JIDs (toLowerCase and trim extra spaces)
function normalizeJid(jid) {
  return jid ? jid.trim().toLowerCase() : "";
}

// Terminal input interface – all prompts in Romanian
// We define askQuestion without recreating the interface repeatedly
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(chalk.red(query), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Function to check for an internet connection; waits until the connection returns
async function waitForInternet() {
  console.log(chalk.red("⏳ Conexiunea a fost pierdută. Aștept conexiunea la internet..."));
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      dns.resolve("google.com", (err) => {
        if (!err) {
          console.log(chalk.red("✔ Conexiunea a revenit, reluăm trimiterea de unde a rămas."));
          clearInterval(interval);
          resolve(true);
        }
      });
    }, 5000);
  });
}

// Banner – displayed exclusively in Romanian
console.log(chalk.red(`===================================
        GYOVANNY WHATSAPP SCRIPT👑
===================================`));

// Global configuration for the bot (sending settings)
global.botConfig = {};

// Global variable to retain the chosen connection method (1 = pairing code, 2 = QR code)
global.connectionMethod = null;

// Object for active sessions: key is chatId, value is { running, currentIndex, delay, mentionJids }
let activeSessions = {};

// Object for the group name-changing loop per chat
let activeNameLoops = {};

// Global variable for owner (set during pairing); only the owner can use the commands
global.owner = null;

// Function for the infinite group name-changing loop
async function groupNameLoop(chatId, sock) {
  while (activeNameLoops[chatId] && activeNameLoops[chatId].running) {
    const loopData = activeNameLoops[chatId];
    const currentName = loopData.groupNames[loopData.currentIndex];
    try {
      await sock.groupUpdateSubject(chatId, currentName);
      console.log(chalk.red(`[GroupNameLoop] Grupul ${chatId} a fost actualizat la: ${currentName}`));
    } catch (error) {
      console.error(chalk.red(`[GroupNameLoop] Eroare la schimbarea numelui grupului ${chatId}:`), error);
    }
    loopData.currentIndex = (loopData.currentIndex + 1) % loopData.groupNames.length;
    await delay(loopData.delay);
  }
  console.log(chalk.red(`[GroupNameLoop] Sesiunea de schimbare nume pentru ${chatId} s-a încheiat.`));
}

// Handling the /start command – creates/updates the sending session for messages/images
function handleStartCommand(chatId, delayValue, mentionJids, sock) {
  if (activeSessions[chatId]) {
    activeSessions[chatId].delay = delayValue;
    activeSessions[chatId].mentionJids = mentionJids;
    console.log(chalk.red(`Sesiunea pentru ${chatId} a fost actualizată.`));
    return;
  }
  activeSessions[chatId] = {
    running: true,
    currentIndex: 0,
    delay: delayValue,
    mentionJids: mentionJids
  };
  sendLoop(chatId, sock);
}

// Handling the /stop command – stops the sending session
function handleStopCommand(chatId) {
  if (activeSessions[chatId]) {
    activeSessions[chatId].running = false;
    console.log(chalk.red(`Sesiunea pentru ${chatId} a fost oprită.`));
  }
}

// The sending loop – attempts to send the current message/image; on error, waits for the internet to return
async function sendLoop(chatId, sock) {
  const config = global.botConfig;
  let session = activeSessions[chatId];
  while (session && session.running) {
    try {
      if (config.sendType === "mesaje") {
        const baseText = config.messages[session.currentIndex];
        let textToSend = baseText;
        if (session.mentionJids && session.mentionJids.length > 0) {
          const mentionsText = session.mentionJids
            .map((jid) => "@" + normalizeJid(jid).split("@")[0])
            .join(" ");
          textToSend = `${baseText} ${mentionsText}`;
        }
        await sock.sendMessage(chatId, { 
          text: textToSend,
          contextInfo: { mentionedJid: session.mentionJids || [] } 
        });
        console.log(chalk.red(`👑 Mesaj trimis către ${chatId}: "${textToSend}"`));
        session.currentIndex = (session.currentIndex + 1) % config.messages.length;
      } else if (config.sendType === "poze") {
        await sock.sendMessage(chatId, {
          image: config.photoBuffer,
          caption: config.photoCaption,
          contextInfo: { mentionedJid: session.mentionJids || [] }
        });
        console.log(chalk.red(`👑 Poză trimisă către ${chatId}.`));
      }
    } catch (error) {
      console.error(chalk.red(`⇌ Eroare la trimiterea către ${chatId}:`), error);
      console.log(chalk.red("⏳ Aștept revenirea internetului..."));
      await waitForInternet();
      console.log(chalk.red("Reinitializing connection..."));
      return;
    }
    await delay(session.delay);
    session = activeSessions[chatId];
  }
  if (activeSessions[chatId]) {
    delete activeSessions[chatId];
    console.log(chalk.red(`Sesiunea pentru ${chatId} s-a încheiat.`));
  }
}

// Resume all active sessions after reconnection
function resumeActiveSessions(sock) {
  for (const chatId in activeSessions) {
    if (activeSessions[chatId].running) {
      console.log(chalk.red(`Reluăm trimiterea în conversația ${chatId}...`));
      sendLoop(chatId, sock);
    }
  }
}

// Setup the message commands – only process commands sent by you (fromMe)
// The commands are processed if the text starts with "/" or if it is exactly ".vv"
function setupCommands(sock) {
  sock.ev.on("messages.upsert", async (up) => {
    if (!up.messages) return;
    for (const msg of up.messages) {
      if (!msg.message) continue;
      if (!msg.key.fromMe) continue;
      
      const chatId = msg.key.remoteJid;
      let text = msg.message.conversation ||
                 (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text);
      if (!text) continue;
      text = text.trim();

      // NEW COMMAND: .vv – when you reply with .vv to a view-once media message,
      // download the media from the quoted message and re-send it as a normal message.
      if (text === ".vv") {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo || !contextInfo.quotedMessage) {
          console.log(chalk.red("No quoted message found for .vv command."));
          continue;
        }
        const quotedMsg = contextInfo.quotedMessage;
        try {
          const mediaBuffer = await downloadMediaMessage(
            quotedMsg,
            'buffer',
            {},
            { logger: Pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
          );
          let content = {};
          if (quotedMsg.imageMessage) {
            content = { image: mediaBuffer };
          } else if (quotedMsg.videoMessage) {
            content = { video: mediaBuffer };
          } else if (quotedMsg.audioMessage) {
            content = { audio: mediaBuffer };
          } else {
            console.log(chalk.red("The quoted message does not contain view-once media."));
            continue;
          }
          await sock.sendMessage(chatId, content);
          console.log(chalk.red("View-once media successfully re-sent as a normal message."));
        } catch (err) {
          console.error(chalk.red("Error processing .vv command:"), err);
        }
        continue;
      }

      // Process commands that start with "/" (skip messages that neither start with "/" nor equal ".vv")
      if (!text.startsWith("/") && text !== ".vv") continue;

      // Command: /stopgroupname – stop the group name-changing loop
      if (text.toLowerCase() === "/stopgroupname") {
        if (activeNameLoops[chatId]) {
          activeNameLoops[chatId].running = false;
          delete activeNameLoops[chatId];
          console.log(chalk.red(`[GroupNameLoop] S-a oprit loop-ul de schimbare nume pentru grupul ${chatId}`));
        } else {
          console.log(chalk.red("Nu există niciun loop activ pentru schimbarea numelui în acest chat."));
        }
        continue;
      }

      // Command: /groupnameNP – initiate the group name-changing loop
      if (text.toLowerCase().startsWith("/groupname")) {
        const regex = /^\/groupname(\d+)\s+(.+)$/i;
        const match = text.match(regex);
        if (match) {
          const delaySeconds = parseInt(match[1], 10);
          const namesString = match[2].trim();
          const groupNames = namesString.split(",").map(name => name.trim()).filter(name => name.length > 0);
          if (groupNames.length === 0) {
            console.log(chalk.red("Nu ai specificat niciun nume valid pentru grup."));
            continue;
          }
          activeNameLoops[chatId] = {
            running: true,
            delay: delaySeconds * 1000,
            groupNames: groupNames,
            currentIndex: 0
          };
          console.log(chalk.red(`[GroupNameLoop] Grupul ${chatId} va fi actualizat secvențial cu următoarele nume: ${groupNames.join(", ")} la interval de ${delaySeconds} secunde.`));
          groupNameLoop(chatId, sock);
        } else {
          console.log(chalk.red("Format invalid pentru comanda /groupname. Exemplu: /groupname10 Grupul Tău, Grupul de firme, Grupul Rompetrol, Grupul Lui"));
        }
        continue;
      }

      // NEW: Command /kick – remove participants from a group
      if (text.toLowerCase().startsWith("/kick")) {
        if (!chatId.endsWith("@g.us")) {
          console.log(chalk.red("Comanda /kick este disponibilă doar în grupuri!"));
          continue;
        }
        const tokens = text.split(/\s+/);
        let participantsToKick = [];
        if (tokens.slice(1).some((token) => token.toLowerCase() === "@all")) {
          try {
            const metadata = await sock.groupMetadata(chatId);
            const toKick = metadata.participants.map((p) => p.id).filter((id) => id !== global.owner);
            participantsToKick = toKick;
          } catch (error) {
            console.error(chalk.red("Eroare la extragerea membrilor grupului pentru comanda /kick @all:"), error);
            continue;
          }
        } else {
          for (const token of tokens.slice(1)) {
            if (token.startsWith("@")) {
              let jid = token.substring(1);
              if (!jid.includes("@")) {
                jid = jid + "@s.whatsapp.net";
              }
              participantsToKick.push(jid);
            }
          }
        }
        if (participantsToKick.length === 0) {
          console.log(chalk.red("Nu ai furnizat niciun participant valid pentru comanda /kick."));
          continue;
        }
        try {
          await sock.groupParticipantsUpdate(chatId, participantsToKick, 'remove');
          console.log(chalk.red(`Comanda /kick executată: au fost eliminați participanții: ${participantsToKick.join(", ")}`));
        } catch (error) {
          console.error(chalk.red("Eroare la executarea comenzii /kick:"), error);
        }
        continue;
      }

      // NEW: Command /add – add participants to a group
      if (text.toLowerCase().startsWith("/add")) {
        if (!chatId.endsWith("@g.us")) {
          console.log(chalk.red("Comanda /add este disponibilă doar în grupuri!"));
          continue;
        }
        const tokens = text.split(/\s+/);
        if (tokens.length < 2) {
          console.log(chalk.red("Nu ai specificat niciun participant pentru /add."));
          continue;
        }
        let participantsToAdd = [];
        for (const token of tokens.slice(1)) {
          if (token.startsWith("@")) {
            let jid = token.substring(1);
            if (!jid.includes("@")) {
              jid = jid + "@s.whatsapp.net";
            }
            participantsToAdd.push(jid);
          }
        }
        if (participantsToAdd.length === 0) {
          console.log(chalk.red("Nu ai furnizat niciun participant valid pentru /add."));
          continue;
        }
        try {
          await sock.groupParticipantsUpdate(chatId, participantsToAdd, 'add');
          console.log(chalk.red(`Comanda /add executată: participanții adăugați sunt: ${participantsToAdd.join(", ")}`));
        } catch (error) {
          console.error(chalk.red("Eroare la executarea comenzii /add:"), error);
        }
        continue;
      }

      // Process remaining commands starting with "/"
      if (!text.startsWith("/")) continue;
      if (text.toLowerCase() === "/stop") {
        handleStopCommand(chatId);
      } else if (text.toLowerCase().startsWith("/start")) {
        const regex = /^\/start(\d*)\s*(.*)$/i;
        const match = text.match(regex);
        if (match) {
          const delayDigits = match[1];
          const remainder = match[2].trim();
          const delayValue = delayDigits ? parseInt(delayDigits, 10) * 1000 : global.botConfig.defaultDelay;
          let mentionJids = [];
          if (remainder) {
            if (remainder.toLowerCase() === "@all") {
              if (chatId.endsWith("@g.us")) {
                try {
                  const metadata = await sock.groupMetadata(chatId);
                  if (metadata && metadata.participants) {
                    mentionJids = metadata.participants.map((participant) => participant.id);
                  }
                } catch (error) {
                  console.error(chalk.red("Eroare la extragerea membrilor grupului:"), error);
                }
              } else {
                console.log(chalk.red("Comanda @all este disponibilă doar în grupuri!"));
              }
            } else {
              const tokens = remainder.split(/\s+/);
              tokens.forEach((token) => {
                if (token.startsWith("@")) {
                  let jid = token.substring(1);
                  if (!jid.includes("@")) {
                    jid = jid + "@s.whatsapp.net";
                  }
                  mentionJids.push(jid);
                }
              });
            }
          }
          handleStartCommand(chatId, delayValue, mentionJids, sock);
        }
      }
    }
  });
}

// Initial configuration: choose content type (messages/images) and load the corresponding file
async function initializeBotConfig(sock) {
  if (!global.botConfig.sendType) {
    let sendType = await askQuestion("Ce vrei să trimiți? (mesaje/poze): ");
    sendType = sendType.toLowerCase();
    if (sendType !== "mesaje" && sendType !== "poze") {
      console.log(chalk.red("Opțiune invalidă!"));
      process.exit(1);
    }
    global.botConfig.sendType = sendType;
    if (sendType === "mesaje") {
      const textPath = await askQuestion("Enter your text path here: ");
      if (!fs.existsSync(textPath)) {
        console.error(chalk.red("⛔ Fișierul text nu există!"));
        process.exit(1);
      }
      const fileContent = fs.readFileSync(textPath, "utf8");
      const messages = fileContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      global.botConfig.messages = messages;
    } else if (sendType === "poze") {
      const photoPath = await askQuestion("Enter file path for photo: ");
      if (!fs.existsSync(photoPath)) {
        console.error(chalk.red("⛔ Fișierul foto nu există!"));
        process.exit(1);
      }
      global.botConfig.photoBuffer = fs.readFileSync(photoPath);
      global.botConfig.photoCaption = await askQuestion("Enter caption (optional): ");
    }
    global.botConfig.defaultDelay = 5000;
    console.log(chalk.red("\n✔ Configurare finalizată. Așteptăm comenzile tale (/start, /stop, /groupname, /stopgroupname, /kick, /add) în orice chat."));
  }
  setupCommands(sock);
  resumeActiveSessions(sock);
}

// Initialize connection and bot configuration
async function startBot() {
  console.log(chalk.red("🔍 Pornire bot WhatsApp..."));
  
  // If the connection method has not been chosen yet, display the menu
  let connectionChoice;
  if (!global.connectionMethod) {
    console.log(chalk.red("=============================="));
    console.log(chalk.red("   Alege metoda de conectare:"));
    console.log(chalk.red("   1. Cod de asociere"));
    console.log(chalk.red("   2. Cod QR"));
    console.log(chalk.red("=============================="));
    connectionChoice = await askQuestion("Introdu numărul metodei (1 sau 2): ");
    global.connectionMethod = connectionChoice;
  } else {
    connectionChoice = global.connectionMethod;
  }
  
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  let sock;
  
  if (connectionChoice === "1") {
    // Pairing code method
    sock = makeWASocket({
      auth: state,
      logger: Pino({ level: "silent" }),
      connectTimeoutMs: 60000
    });
    if (!sock.authState.creds.registered) {
      const phoneNumber = await askQuestion("Enter your Phone number for pairing (ex. 40748427351): ");
      console.log(chalk.red(`This is your Phone number: ${phoneNumber}`));
      global.owner = normalizeJid(phoneNumber.includes("@") ? phoneNumber : `${phoneNumber}@s.whatsapp.net`);
      console.log(chalk.red(`Owner set to: ${global.owner}`));
      try {
        const pairingCode = await sock.requestPairingCode(phoneNumber);
        if (pairingCode) {
          console.log(chalk.red(`This is your pairing code: ${pairingCode}`));
          console.log(chalk.red("Open WhatsApp and enter this code in the linked device."));
        } else {
          console.error(chalk.red("Pairing code was not generated. Please check your network and try again."));
        }
      } catch (error) {
        console.error(chalk.red("Error generating pairing code:"), error);
      }
    } else {
      if (!global.owner) {
        global.owner = sock.user && sock.user.id ? normalizeJid(sock.user.id) : "unknown";
        console.log(chalk.red(`Owner is already set to: ${global.owner}`));
      }
      console.log(chalk.red("✔ Already connected!"));
    }
  } else if (connectionChoice === "2") {
    // QR Code method
    sock = makeWASocket({
      auth: state,
      logger: Pino({ level: "silent" }),
      connectTimeoutMs: 60000,
      printQRInTerminal: false
    });
    sock.ev.on("connection.update", (update) => {
      if (update.qr) {
        console.clear();
        console.log(chalk.red("\nScanează codul QR afișat mai jos cu telefonul tău (WhatsApp > Linked Devices > Link a Device):\n"));
        qrcode.generate(update.qr, { small: true });
      }
    });
  } else {
    console.log(chalk.red("Opțiune invalidă! Rulează din nou scriptul."));
    process.exit(1);
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      console.log(chalk.red("✔ Conectat la WhatsApp!"));
      if (global.botConfig.sendType) {
        setupCommands(sock);
        resumeActiveSessions(sock);
      } else {
        await initializeBotConfig(sock);
      }
    } else if (connection === "close") {
      console.log(chalk.red("⏳ Conexiunea a fost pierdută."));
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        await waitForInternet();
        await startBot();
      } else {
        console.log(chalk.red("⇌ Deconectare definitivă. Restart manual necesar."));
        process.exit(1);
      }
    }
  });
  sock.ev.on("creds.update", saveCreds);
}

// Prevent script from stopping on unexpected errors
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});

// Start the bot
startBot();
