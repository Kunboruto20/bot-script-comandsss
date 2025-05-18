Bot Comandsss 🚀

A super-powerful bot built with Boruto Commands Bot, ready to run on Termux, PC, or Mac! Perfect for quick automations and custom commands.


---

🔥 Features

🎯 Interactive menu with Inquirer

⏱️ Customizable delay between commands

💬 Send messages to contacts and groups

🛡️ Full control through /start and /stop commands

🔥 Red-highlighted logging for maximum visibility

🤖 Runs 24/7 on Termux, Linux, Windows, and macOS



---

🛠️ Prerequisites

Node.js v14+ & npm

Git

(For Termux) Termux with pkg, bash, nodejs



---

⚡ Installation

Choose your platform:

1. Termux (Android)

# 1. Install basic packages
pkg update && pkg upgrade -y
pkg install git nodejs bash -y

# 2. Clone the repo and install dependencies
git clone https://github.com/gyovannyvpn123/bot-comandsss.git
cd bot-comandsss
npm install
bash install.sh  # Additional setup if needed

# 3. Run the bot
node index.js

2. Linux / WSL (PC)

# 1. Clone and install
git clone https://github.com/gyovannyvpn123/bot-comandsss.git
cd bot-comandsss
npm install

# 2. (Optional) Run installation script
bash install.sh

# 3. Start the bot
node index.js

3. Windows (CMD / PowerShell)

# 1. Clone the repo
git clone https://github.com/gyovannyvpn123/bot-comandsss.git
cd bot-comandsss

# 2. Install dependencies
npm install

# 3. (Optional) Run installer
bash install.sh  # Requires Git Bash or WSL

# 4. Run the bot
node index.js

4. macOS

# 1. Make sure you have Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install Node.js & Git
brew install node git

# 3. Clone and install
git clone https://github.com/gyovannyvpn123/bot-comandsss.git
cd bot-comandsss
npm install
bash install.sh

# 4. Run the bot
node index.js


---

🚀 Usage

1. On first run, you'll see a welcome message and command menu.


2. Use arrows and Enter to select options.


3. Use /start <delay> and /stop to control message sending.


4. Watch the console for red-highlighted logs.




---

📝 Advanced Configuration

Edit config.json for custom settings (delay, ID list, etc).

Add custom scripts under the scripts/ folder.



---

🤝 Contributions

1. Fork the repository


2. Create a new branch feature/XYZ


3. Commit & Push


4. Open a Pull Request




---

📄 License

Distributed under the MIT License. See LICENSE for more info.

