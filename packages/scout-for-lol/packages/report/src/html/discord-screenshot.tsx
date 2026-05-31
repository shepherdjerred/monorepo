import satori from "satori";
import { font, bunSpiegelFonts } from "#src/assets/index.ts";
import { svgToPng } from "#src/html/index.tsx";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 820;
const DEFAULT_EMBED_IMAGE_WIDTH = 940;
const CANVAS_HORIZONTAL_PADDING = 46;
const TIMESTAMP_WIDTH = 96;
const AVATAR_SIZE = 40;
const AVATAR_COLUMN_WIDTH = 54;
const CONTENT_WIDTH =
  CANVAS_WIDTH -
  CANVAS_HORIZONTAL_PADDING * 2 -
  TIMESTAMP_WIDTH -
  AVATAR_COLUMN_WIDTH;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type ImageDimensions = {
  width: number;
  height: number;
};

export type DiscordChatMessage = {
  author: string;
  content: string;
  timestamp?: string | undefined;
  authorColor?: string | undefined;
  avatarText?: string | undefined;
  avatarColor?: string | undefined;
};

export type DiscordScreenshotOptions = {
  embeddedImageBytes: Uint8Array;
  timestamp?: string | undefined;
  appName?: string | undefined;
  appNameColor?: string | undefined;
  botMessage?: string | undefined;
  botAvatarText?: string | undefined;
  botAvatarColor?: string | undefined;
  embedImageWidth?: number | undefined;
  chatMessagesBeforeEmbed?: DiscordChatMessage[] | undefined;
  chatMessagesAfterEmbed?: DiscordChatMessage[] | undefined;
};

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }

  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function byteAt(bytes: Uint8Array, index: number): number {
  const byte = bytes[index];
  if (byte === undefined) {
    throw new Error("Invalid PNG input");
  }
  return byte;
}

function readPngUint32(bytes: Uint8Array, offset: number): number {
  return (
    byteAt(bytes, offset) * 2 ** 24 +
    byteAt(bytes, offset + 1) * 2 ** 16 +
    byteAt(bytes, offset + 2) * 2 ** 8 +
    byteAt(bytes, offset + 3)
  );
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions {
  if (!isPng(bytes)) {
    throw new Error("Discord screenshot renderer only supports PNG input");
  }
  if (bytes.length < 24) {
    throw new Error("Invalid PNG input");
  }

  const width = readPngUint32(bytes, 16);
  const height = readPngUint32(bytes, 20);
  if (width <= 0 || height <= 0) {
    throw new Error("Invalid PNG input");
  }

  return { width, height };
}

function resizeToDisplayWidth(
  dimensions: ImageDimensions,
  displayWidth: number,
): ImageDimensions {
  const scale = Math.min(displayWidth / dimensions.width, 1);

  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale),
  };
}

function pngDataUri(bytes: Uint8Array): string {
  if (!isPng(bytes)) {
    throw new Error("Discord screenshot renderer only supports PNG input");
  }

  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

function TimestampColumn(props: {
  timestamp?: string | undefined;
  paddingTop?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: TIMESTAMP_WIDTH,
        flexShrink: 0,
        justifyContent: "flex-end",
        paddingTop: props.paddingTop ?? 8,
        paddingRight: 14,
        color: "#949ba4",
        fontSize: 20,
        fontWeight: 400,
        lineHeight: 1,
        opacity: 0.78,
        whiteSpace: "nowrap",
      }}
    >
      {props.timestamp ?? ""}
    </div>
  );
}

function avatarColor(color: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? color : "#5865f2";
}

function avatarLabel(label: string): string {
  return label.trim().slice(0, 2).toUpperCase() || "S";
}

function MessageAvatar(props: { backgroundColor: string; label: string }) {
  const backgroundColor = avatarColor(props.backgroundColor);

  return (
    <div
      style={{
        display: "flex",
        width: AVATAR_COLUMN_WIDTH,
        height: 44,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          borderRadius: AVATAR_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor,
          color: "#ffffff",
          fontSize: 18,
          fontWeight: 800,
          lineHeight: 1,
        }}
      >
        {avatarLabel(props.label)}
      </div>
    </div>
  );
}

function ChatMessageRow(props: { message: DiscordChatMessage }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        width: "100%",
      }}
    >
      <TimestampColumn
        {...(props.message.timestamp === undefined
          ? {}
          : { timestamp: props.message.timestamp })}
        paddingTop={4}
      />
      <MessageAvatar
        backgroundColor={props.message.avatarColor ?? "#5865f2"}
        label={props.message.avatarText ?? props.message.author}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          gap: 12,
          width: CONTENT_WIDTH,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            color: props.message.authorColor ?? "#f2f3f5",
            fontSize: 28,
            fontWeight: 700,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          {props.message.author}
        </div>
        <div
          style={{
            display: "flex",
            color: "#dbdee1",
            fontSize: 28,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          {props.message.content}
        </div>
      </div>
    </div>
  );
}

function BotMessageRow(props: {
  embeddedImageDataUri: string;
  embeddedImageLayout: ImageDimensions;
  timestamp: string;
  appName: string;
  appNameColor: string;
  botMessage: string | undefined;
  botAvatarText: string;
  botAvatarColor: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        width: "100%",
      }}
    >
      <TimestampColumn timestamp={props.timestamp} />
      <MessageAvatar
        backgroundColor={props.botAvatarColor}
        label={props.botAvatarText}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          width: CONTENT_WIDTH,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            height: 44,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              backgroundColor: "#5865f2",
              color: "#ffffff",
              fontSize: 25,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            APP
          </div>
          <div
            style={{
              display: "flex",
              color: props.appNameColor,
              fontSize: 30,
              fontWeight: 700,
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {props.appName}
          </div>
          {props.botMessage === undefined ? null : (
            <div
              style={{
                display: "flex",
                color: "#f2f3f5",
                fontSize: 30,
                fontWeight: 400,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {props.botMessage}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            width: props.embeddedImageLayout.width + 40,
            height: props.embeddedImageLayout.height + 40,
            padding: 20,
            border: "2px solid #4a4d55",
            borderRadius: 10,
            backgroundColor: "#383a42",
            overflow: "hidden",
          }}
        >
          <img
            alt=""
            src={props.embeddedImageDataUri}
            width={props.embeddedImageLayout.width}
            height={props.embeddedImageLayout.height}
            style={{
              width: props.embeddedImageLayout.width,
              height: props.embeddedImageLayout.height,
              borderRadius: 8,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function DiscordScreenshot(props: {
  embeddedImageDataUri: string;
  embeddedImageLayout: ImageDimensions;
  timestamp: string;
  appName: string;
  appNameColor: string;
  botMessage: string | undefined;
  botAvatarText: string;
  botAvatarColor: string;
  chatMessagesBeforeEmbed: DiscordChatMessage[];
  chatMessagesAfterEmbed: DiscordChatMessage[];
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 22,
        overflow: "hidden",
        backgroundColor: "#313338",
        color: "#f2f3f5",
        fontFamily: font.body,
        padding: `44px ${CANVAS_HORIZONTAL_PADDING.toString()}px`,
      }}
    >
      {props.chatMessagesBeforeEmbed.map((message, index) => (
        <ChatMessageRow key={`before-${index.toString()}`} message={message} />
      ))}
      <BotMessageRow
        embeddedImageDataUri={props.embeddedImageDataUri}
        embeddedImageLayout={props.embeddedImageLayout}
        timestamp={props.timestamp}
        appName={props.appName}
        appNameColor={props.appNameColor}
        botMessage={props.botMessage}
        botAvatarText={props.botAvatarText}
        botAvatarColor={props.botAvatarColor}
      />
      {props.chatMessagesAfterEmbed.map((message, index) => (
        <ChatMessageRow key={`after-${index.toString()}`} message={message} />
      ))}
    </div>
  );
}

export async function discordScreenshotToSvg(
  options: DiscordScreenshotOptions,
): Promise<string> {
  const embeddedImageLayout = resizeToDisplayWidth(
    readPngDimensions(options.embeddedImageBytes),
    options.embedImageWidth ?? DEFAULT_EMBED_IMAGE_WIDTH,
  );
  const embeddedImageDataUri = pngDataUri(options.embeddedImageBytes);
  const fonts = await bunSpiegelFonts();

  return await satori(
    <DiscordScreenshot
      embeddedImageDataUri={embeddedImageDataUri}
      embeddedImageLayout={embeddedImageLayout}
      timestamp={options.timestamp ?? "5:23 AM"}
      appName={options.appName ?? "Scout for LoL"}
      appNameColor={options.appNameColor ?? "#f2f3f5"}
      botMessage={options.botMessage}
      botAvatarText={options.botAvatarText ?? "S"}
      botAvatarColor={options.botAvatarColor ?? "#5865f2"}
      chatMessagesBeforeEmbed={options.chatMessagesBeforeEmbed ?? []}
      chatMessagesAfterEmbed={options.chatMessagesAfterEmbed ?? []}
    />,
    {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fonts,
    },
  );
}

export async function discordScreenshotToImage(
  options: DiscordScreenshotOptions,
): Promise<Uint8Array> {
  const svg = await discordScreenshotToSvg(options);
  return await svgToPng(svg, { crop: false });
}
