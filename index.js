// Importă pachetul complet și destructurează ce ai nevoie
import pkg from '@borutowaileys/library';
const { makeWASocket, useMultiFileAuthState } = pkg;
const DisconnectReason = pkg.DisconnectReason;

import Pino from "pino";
import fs from "fs";
import readline from "readline";
import process from "process";
import dns from "dns";
import chalk from "chalk";
import qrcode from "qrcode-terminal";

// Helper pentru delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Funcție de normalizare pentru JID-uri (toLowerCase, elimină spațiile suplimentare)
function normalizeJid(jid) {
  return jid ? jid.trim().toLowerCase() : "";
}

// Interfață pentru input în terminal – toate întrebările apar în română
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Funcție pentru întrebări în terminal
const askQuestion = (query) =>
  new Promise((resolve) => {
    rl.question(chalk.red(query), (answer) => resolve(answer.trim()));
  });

// Funcție de verificare a conexiunii la internet; blochează până când conexiunea revine
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

// Banner – afișat exclusiv în română
console.log(chalk.red(`===================================
        GYOVANNY WHATSAPP SCRIPT👑
===================================`));

// Configurație globală pentru bot (setările de trimitere)
global.botConfig = {};

// Obiectul pentru sesiunile active: cheia este chatId, iar valoarea este { running, currentIndex, delay, mentionJids }
let activeSessions = {};

// Obiect pentru loop-ul de schimbare nume pentru fiecare chat
let activeNameLoops = {};

// Variabilă globală pentru owner (setată la pairing); doar owner-ul poate folosi comenzile
global.owner = null;

// Funcție pentru loop-ul infinit de schimbare a numelui grup
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
    // Trece la următorul nume din listă, ciclând la început după ultimul element
    loopData.currentIndex = (loopData.currentIndex + 1) % loopData.groupNames.length;
    await delay(loopData.delay);
  }
  console.log(chalk.red(`[GroupNameLoop] Sesiunea de schimbare nume pentru ${chatId} s-a încheiat.`));
}

// Gestionarea comenzii /start – creează/actualizează sesiunea de trimitere pentru mesaje/poze
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

// Gestionarea comenzii /stop – oprește sesiunea de trimitere mesaje/poze
function handleStopCommand(chatId) {
  if (activeSessions[chatId]) {
    activeSessions[chatId].running = false;
    console.log(chalk.red(`Sesiunea pentru ${chatId} a fost oprită.`));
  }
}

// Bucla de trimitere – încearcă să trimită mesajul sau poza din sesiune; în caz de eroare, așteaptă conexiunea
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

// Reluarea tuturor sesiunilor active după reconectare
function resumeActiveSessions(sock) {
  for (const chatId in activeSessions) {
    if (activeSessions[chatId].running) {
      console.log(chalk.red(`Reluăm trimiterea în conversația ${chatId}...`));
      sendLoop(chatId, sock);
    }
  }
}

// Setăm ascultătorul pentru mesajele primite – se procesează doar comenzile (cele trimise de tine)
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

      // Comanda /stopgroupname – oprește loop-ul de schimbare nume
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

      // Comanda /groupnameNP – inițierea loop-ului de schimbare a numelui grupului
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

      // *** NOU: Comanda /kick ***
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

      // *** NOU: Comanda /add ***
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

      // Procesarea celorlalte comenzi care încep cu "/"
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

// Configurarea inițială: se alege tipul de conținut (mesaje/poze) și se încarcă fișierul corespunzător
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

// Inițializarea conexiunii și configurarea botului
async function startBot() {
  console.log(chalk.red("🔍 Pornire bot WhatsApp..."));
  
  // MENIU: Alege metoda de conectare
  console.log(chalk.red("=============================="));
  console.log(chalk.red("   Alege metoda de conectare:"));
  console.log(chalk.red("   1. Cod de asociere"));
  console.log(chalk.red("   2. Cod QR"));
  console.log(chalk.red("=============================="));
  const connectionChoice = await askQuestion("Introdu numărul metodei (1 sau 2): ");
  
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  let sock;
  
  if (connectionChoice === "1") {
    // Metoda pairing code
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
    // Metoda QR Code
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

// Prevenim oprirea scriptului la erori neprevăzute
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});

// Pornim botul
startBot();
