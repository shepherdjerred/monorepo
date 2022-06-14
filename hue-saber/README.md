# huesaber
Set Philips Hue lights based on Beat Saber events

![A video of the game BeatSaber while this application changes the lights of a Hue bulb](https://user-images.githubusercontent.com/3904778/77979004-51ca9000-72b8-11ea-89e2-b8f2ea4b6a83.gif)

# Requirements
* Node.js (developed with version 9.3.0)
* Beat Saber with the [beatsaber-http-status](https://github.com/opl-/beatsaber-http-status/) plugin (Use the [plugin installer](https://www.modsaber.org/))
* A Philips Hue bridge on the same network as the computer running Beat Saber
* A color bulb set up with the Hue bridge

# Caveats
This application was developed on a network with one Hue bridge and one color bulb. Due to this, there are a few limitations.

* If you have more than one Hue bridge, this will use the first one it finds
* If your bridge has more than one bulb, this will use the first one based on its ID in the bridge
* I'm not sure what will happen if the bulb that is selected is not a color bulb
* It doesn't work well with levels that have very rapid color changes (you'll see errors in the console if the bulb cannot keep up with the colors)

# How to use huesaber
1. Install dependencies with `npm i`
2. Build the project with npm run build
3. Copy the `.env.sample` file to `.env`
4. Edit the SOCKET_URL value in the .env file if needed (this is not required if you are running this program on the same computer that is running Beat Saber)
5. Start Beat Saber
6. Press the button on your Hue bridge
7. Run the program with `npm run start`

# Important Notes
* Beat Saber must be running with the http status plugin before starting the program, otherwise and error will occur
* On the first run of this program, you must press the button on your Hue bridge **before** starting it
* After sucessfully running the program once, you do not need to press the Hue bridge button for subsequent startups
