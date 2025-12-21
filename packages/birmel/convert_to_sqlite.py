#!/usr/bin/env python3
"""Convert Discord export (from glitter-boys.zip) to SQLite database."""

import csv
import sqlite3
import os
import re
from pathlib import Path
from datetime import datetime

EXTRACTED_DIR = Path(__file__).parent / "glitter-boys-extracted"
DB_PATH = Path(__file__).parent / "glitter-boys.db"

# Increase CSV field size limit
csv.field_size_limit(10 * 1024 * 1024)


def create_schema(conn: sqlite3.Connection):
    """Create the database schema."""
    cursor = conn.cursor()

    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            global_name TEXT,
            discriminator TEXT,
            avatar TEXT,
            bot INTEGER DEFAULT 0,
            accent_color TEXT,
            banner TEXT,
            banner_color TEXT,
            public_flags INTEGER
        )
    """)

    # Servers/guilds table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        )
    """)

    # Channels table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            server_id TEXT,
            name TEXT NOT NULL,
            FOREIGN KEY (server_id) REFERENCES servers(id)
        )
    """)

    # Threads table (channels within channels)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            channel_id TEXT,
            name TEXT NOT NULL,
            FOREIGN KEY (channel_id) REFERENCES channels(id)
        )
    """)

    # Messages table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            channel_id TEXT,
            thread_id TEXT,
            author_id TEXT,
            content TEXT,
            timestamp TEXT,
            edited_timestamp TEXT,
            pinned INTEGER DEFAULT 0,
            mention_everyone INTEGER DEFAULT 0,
            flags INTEGER,
            message_reference_id TEXT,
            FOREIGN KEY (channel_id) REFERENCES channels(id),
            FOREIGN KEY (thread_id) REFERENCES threads(id),
            FOREIGN KEY (author_id) REFERENCES users(id)
        )
    """)

    # Attachments table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT,
            filename TEXT,
            content_type TEXT,
            url TEXT,
            proxy_url TEXT,
            size INTEGER,
            width INTEGER,
            height INTEGER,
            FOREIGN KEY (message_id) REFERENCES messages(id)
        )
    """)

    # Reactions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            emoji_id TEXT,
            emoji_name TEXT,
            emoji_animated INTEGER DEFAULT 0,
            count INTEGER DEFAULT 0,
            FOREIGN KEY (message_id) REFERENCES messages(id)
        )
    """)

    # Mentions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS mentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            user_id TEXT,
            FOREIGN KEY (message_id) REFERENCES messages(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Emojis table (custom server emojis with image data)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS emojis (
            id TEXT PRIMARY KEY,
            name TEXT,
            animated INTEGER DEFAULT 0,
            image_path TEXT,
            image_data BLOB
        )
    """)

    # Avatars table (user avatars with image data)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS avatars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            avatar_hash TEXT,
            image_path TEXT,
            image_data BLOB,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Roles table (server roles with icons)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id TEXT,
            name TEXT,
            image_path TEXT,
            image_data BLOB,
            FOREIGN KEY (server_id) REFERENCES servers(id)
        )
    """)

    # Create indexes for common queries
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mentions_message ON mentions(message_id)")

    conn.commit()


def parse_server_and_channel(path: Path) -> tuple[str, str, str]:
    """Extract server name and channel info from path."""
    parts = path.parts
    # Find the server folder (e.g., 'glitter-boys' or 'league-of-legends')
    for i, part in enumerate(parts):
        if part in ('glitter-boys', 'league-of-legends'):
            server_name = part
            # The next part should be the channel folder like 'glitter-boys_A13A_sjs-L'
            if i + 1 < len(parts):
                channel_folder = parts[i + 1]
                if '_' in channel_folder:
                    # Extract channel ID from folder name
                    match = re.match(r'(.+)_([A-Za-z0-9_-]+)$', channel_folder)
                    if match:
                        return server_name, match.group(2), match.group(1)
            break
    return 'unknown', 'unknown', 'unknown'


def parse_thread_name(csv_filename: str) -> str | None:
    """Extract thread name from CSV filename if it's a thread."""
    # Thread files are named like 'Thread Name_page_1.csv'
    # Main channel files are named like 'channel-name_page_1.csv'
    name = csv_filename.replace('_page_', '|page|').rsplit('|page|', 1)[0]
    return name


def upsert_user(cursor: sqlite3.Cursor, row: dict, prefix: str = "author."):
    """Insert or update a user from message data."""
    user_id = row.get(f"{prefix}id")
    if not user_id:
        return None

    cursor.execute("""
        INSERT OR REPLACE INTO users (id, username, global_name, discriminator, avatar, bot, accent_color, banner, banner_color, public_flags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        user_id,
        row.get(f"{prefix}username"),
        row.get(f"{prefix}global_name"),
        row.get(f"{prefix}discriminator"),
        row.get(f"{prefix}avatar"),
        1 if row.get(f"{prefix}bot") == 'True' else 0,
        row.get(f"{prefix}accent_color"),
        row.get(f"{prefix}banner"),
        row.get(f"{prefix}banner_color"),
        int(row.get(f"{prefix}public_flags") or 0) if row.get(f"{prefix}public_flags") else None
    ))
    return user_id


def process_csv_file(conn: sqlite3.Connection, csv_path: Path, server_id: str, channel_id: str, channel_name: str):
    """Process a single CSV file and insert data."""
    cursor = conn.cursor()

    # Determine if this is a thread or main channel
    # Main channel files are like 'channel-name_page_1.csv'
    # Thread files are like 'Thread Name_page_1.csv'
    filename = csv_path.stem

    # Extract the base name before _page_N
    match = re.match(r'(.+)_page_\d+$', filename)
    base_name = match.group(1) if match else filename

    # Check if this is the main channel
    # The main channel file's base_name should match or be contained in channel_name
    # E.g., channel_name='glitter-boys_A13A' should match base_name='glitter-boys'
    base_normalized = base_name.lower().replace('-', ' ').replace('_', ' ')
    channel_normalized = channel_name.lower().replace('-', ' ').replace('_', ' ')
    is_main_channel = base_normalized in channel_normalized or channel_normalized.startswith(base_normalized)

    thread_id = None
    if not is_main_channel:
        # This is a thread
        thread_name = base_name
        thread_id = f"{channel_id}_{hash(thread_name) % 10**12}"  # Generate a stable ID
        cursor.execute("""
            INSERT OR IGNORE INTO threads (id, channel_id, name)
            VALUES (?, ?, ?)
        """, (thread_id, channel_id, thread_name))

    with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        for row in reader:
            msg_id = row.get('id')
            if not msg_id:
                continue

            # Insert author
            author_id = upsert_user(cursor, row, "author.")

            # Insert mentioned users
            for i in range(10):
                mention_id = upsert_user(cursor, row, f"mentions.{i}.")
                if mention_id:
                    cursor.execute("""
                        INSERT OR IGNORE INTO mentions (message_id, user_id)
                        VALUES (?, ?)
                    """, (msg_id, mention_id))

            # Insert message
            cursor.execute("""
                INSERT OR REPLACE INTO messages (id, channel_id, thread_id, author_id, content, timestamp, edited_timestamp, pinned, mention_everyone, flags, message_reference_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                msg_id,
                channel_id,
                thread_id,
                author_id,
                row.get('content'),
                row.get('date'),
                row.get('edited_timestamp') if row.get('edited_timestamp') else None,
                1 if row.get('pinned') == 'True' else 0,
                1 if row.get('mention_everyone') == 'True' else 0,
                int(row.get('flags') or 0) if row.get('flags') else None,
                row.get('message_reference.message_id')
            ))

            # Insert attachments
            for i in range(10):
                att_id = row.get(f'attachments.{i}.id')
                if att_id:
                    cursor.execute("""
                        INSERT OR REPLACE INTO attachments (id, message_id, filename, content_type, url, proxy_url, size, width, height)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        att_id,
                        msg_id,
                        row.get(f'attachments.{i}.filename'),
                        row.get(f'attachments.{i}.content_type'),
                        row.get(f'attachments.{i}.url'),
                        row.get(f'attachments.{i}.proxy_url'),
                        int(row.get(f'attachments.{i}.size') or 0) if row.get(f'attachments.{i}.size') else None,
                        int(row.get(f'attachments.{i}.width') or 0) if row.get(f'attachments.{i}.width') else None,
                        int(row.get(f'attachments.{i}.height') or 0) if row.get(f'attachments.{i}.height') else None
                    ))

            # Insert reactions
            for i in range(5):
                emoji_name = row.get(f'reactions.{i}.emoji.name')
                if emoji_name:
                    cursor.execute("""
                        INSERT INTO reactions (message_id, emoji_id, emoji_name, emoji_animated, count)
                        VALUES (?, ?, ?, ?, ?)
                    """, (
                        msg_id,
                        row.get(f'reactions.{i}.emoji.id'),
                        emoji_name,
                        1 if row.get(f'reactions.{i}.emoji.animated') == 'True' else 0,
                        int(row.get(f'reactions.{i}.count') or 0) if row.get(f'reactions.{i}.count') else 0
                    ))

    conn.commit()


def import_emojis(conn: sqlite3.Connection, emojis_dir: Path):
    """Import custom emojis with their image data."""
    cursor = conn.cursor()

    for emoji_file in emojis_dir.iterdir():
        if emoji_file.is_file():
            # Parse emoji name and ID from filename like '!emoji_name!_1234567890.png'
            name = emoji_file.stem
            match = re.match(r'!?(.+?)!?_(\d+)$', name)
            if match:
                emoji_name = match.group(1)
                emoji_id = match.group(2)
            else:
                emoji_name = name
                emoji_id = name

            animated = emoji_file.suffix.lower() == '.gif'

            # Read image data
            with open(emoji_file, 'rb') as f:
                image_data = f.read()

            cursor.execute("""
                INSERT OR REPLACE INTO emojis (id, name, animated, image_path, image_data)
                VALUES (?, ?, ?, ?, ?)
            """, (emoji_id, emoji_name, 1 if animated else 0, str(emoji_file.relative_to(EXTRACTED_DIR)), image_data))

    conn.commit()
    print(f"  Imported {cursor.rowcount} emojis")


def import_avatars(conn: sqlite3.Connection, avatars_dir: Path):
    """Import user avatars with their image data."""
    cursor = conn.cursor()
    count = 0

    for user_dir in avatars_dir.iterdir():
        if user_dir.is_dir():
            user_id = user_dir.name

            for avatar_file in user_dir.iterdir():
                if avatar_file.is_file():
                    avatar_hash = avatar_file.stem

                    # Read image data
                    with open(avatar_file, 'rb') as f:
                        image_data = f.read()

                    cursor.execute("""
                        INSERT INTO avatars (user_id, avatar_hash, image_path, image_data)
                        VALUES (?, ?, ?, ?)
                    """, (user_id, avatar_hash, str(avatar_file.relative_to(EXTRACTED_DIR)), image_data))
                    count += 1

    conn.commit()
    print(f"  Imported {count} avatars")


def import_roles(conn: sqlite3.Connection, roles_dir: Path, server_id: str):
    """Import role icons."""
    cursor = conn.cursor()
    count = 0

    for role_file in roles_dir.iterdir():
        if role_file.is_file():
            # Parse role name from filename like 'Role Name_1234567890.png.png'
            name = role_file.stem
            # Remove double extension if present
            if name.endswith('.png') or name.endswith('.jpeg'):
                name = name.rsplit('.', 1)[0]

            match = re.match(r'(.+)_(\d+)$', name)
            role_name = match.group(1) if match else name

            with open(role_file, 'rb') as f:
                image_data = f.read()

            cursor.execute("""
                INSERT INTO roles (server_id, name, image_path, image_data)
                VALUES (?, ?, ?, ?)
            """, (server_id, role_name, str(role_file.relative_to(EXTRACTED_DIR)), image_data))
            count += 1

    conn.commit()
    print(f"  Imported {count} roles")


def main():
    # Remove existing database
    if DB_PATH.exists():
        DB_PATH.unlink()

    # Connect and create schema
    conn = sqlite3.Connection(DB_PATH)
    create_schema(conn)
    cursor = conn.cursor()

    print("Converting Discord export to SQLite...")

    # Process each server directory
    for server_dir in EXTRACTED_DIR.iterdir():
        if not server_dir.is_dir():
            continue

        server_name = server_dir.name
        server_id = server_name  # Use folder name as ID

        print(f"\nProcessing server: {server_name}")

        # Insert server
        cursor.execute("INSERT OR IGNORE INTO servers (id, name) VALUES (?, ?)", (server_id, server_name))

        # Process emojis if present
        emojis_dir = server_dir / 'emojis'
        if emojis_dir.exists():
            print(f"  Importing emojis...")
            import_emojis(conn, emojis_dir)

        # Process avatars if present
        avatars_dir = server_dir / 'avatars'
        if avatars_dir.exists():
            print(f"  Importing avatars...")
            import_avatars(conn, avatars_dir)

        # Process roles if present
        roles_dir = server_dir / 'roles'
        if roles_dir.exists():
            print(f"  Importing roles...")
            import_roles(conn, roles_dir, server_id)

        # Find channel directories
        for item in server_dir.iterdir():
            if item.is_dir() and '_' in item.name and item.name not in ('avatars', 'emojis', 'roles'):
                # This is a channel directory
                # Format is like 'channel-name_randomID' (e.g., 'glitter-boys_A13A_sjs-L')
                # Split by underscore and use last part as ID
                parts = item.name.rsplit('_', 1)
                if len(parts) == 2:
                    # The folder might have format like 'glitter-boys_A13A_sjs-L'
                    # where we want name='glitter-boys' and id='sjs-L'
                    # Or 'league-of-legends_J2FNCfaV7I'
                    channel_id = parts[1]
                    # For the name, check if there are multiple underscores
                    # Try to match the server name
                    if parts[0].startswith(server_name):
                        # e.g., 'glitter-boys_A13A' -> 'glitter-boys'
                        channel_name = server_name
                    else:
                        channel_name = parts[0]

                    print(f"  Processing channel: {channel_name}")

                    # Insert channel
                    cursor.execute("INSERT OR IGNORE INTO channels (id, server_id, name) VALUES (?, ?, ?)",
                                 (channel_id, server_id, channel_name))

                    # Process all CSV files in the channel
                    csv_files = sorted(item.glob('*.csv'))
                    for csv_file in csv_files:
                        process_csv_file(conn, csv_file, server_id, channel_id, channel_name)

    conn.commit()

    # Print summary statistics
    print("\n" + "="*50)
    print("Database created successfully!")
    print("="*50)

    stats = [
        ("Servers", "SELECT COUNT(*) FROM servers"),
        ("Channels", "SELECT COUNT(*) FROM channels"),
        ("Threads", "SELECT COUNT(*) FROM threads"),
        ("Users", "SELECT COUNT(*) FROM users"),
        ("Messages", "SELECT COUNT(*) FROM messages"),
        ("Attachments", "SELECT COUNT(*) FROM attachments"),
        ("Reactions", "SELECT COUNT(*) FROM reactions"),
        ("Emojis", "SELECT COUNT(*) FROM emojis"),
        ("Avatars", "SELECT COUNT(*) FROM avatars"),
        ("Roles", "SELECT COUNT(*) FROM roles"),
    ]

    for name, query in stats:
        cursor.execute(query)
        count = cursor.fetchone()[0]
        print(f"  {name}: {count:,}")

    # Database file size
    conn.close()
    size_mb = DB_PATH.stat().st_size / (1024 * 1024)
    print(f"\nDatabase size: {size_mb:.2f} MB")
    print(f"Database path: {DB_PATH}")


if __name__ == "__main__":
    main()
