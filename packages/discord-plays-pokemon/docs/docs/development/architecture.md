# Architecture

This application is written in [TypeScript](https://www.typescriptlang.org/). It uses [Selenium Webdriver](https://github.com/SeleniumHQ/selenium) to create a Firefox browser. The application opens two tabs, one for Discord to stream the game, and another to run [EmulatorJS](https://www.emulatorjs.com/), an emulator for many older system that runs directly in the browser.

The application will then login as a real Discord user through the browser, join a voice channel, and start streaming the browser window. The application will then focus the emulator tab so that it is being streamed.

The last component is a Discord bot to handle commands. The application will start a Discord bot that listens for commands in a text channel. When a command is recieved, the bot will send input to the emulator through Selenium.

Two bots are required because Discord bots are unable to stream video, and normal user accounts are unable to register slash commands. There is no way around this limitation.

The process described above allows everything to be done in-browser, which makes this application considerably more portable than alternatives. Additionally, a Docker image is bundled with the application that allows this entire process to happen without any dependencies aside from Docker on the host machine.
