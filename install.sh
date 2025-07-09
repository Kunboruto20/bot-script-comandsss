#!/bin/bash
pkg update -y
pkg upgrade -y
clear 
pkg install nodejs -y
pkg install git -y
clear
pkg install jq -y
clear 
npm install @borutowaileys/library qrcode-terminal pino chalk
npm install
clear
npm install node-fetch
clear
npm start 
