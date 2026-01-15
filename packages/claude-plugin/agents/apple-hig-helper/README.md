# Apple HIG Helper Skill

A Claude skill that provides comprehensive access to Apple's Human Interface Guidelines (HIG).

## Structure

```
apple-hig-helper/
├── README.md          # This file
├── skill.md           # The Claude skill definition
├── data/              # Downloaded HIG documentation (174 HTML files, 23 MB)
│   ├── accessibility/
│   ├── buttons/
│   ├── color/
│   ├── ...
│   └── .visited.json  # List of downloaded URLs
└── scrape.sh          # Script to re-download HIG data
```

## Skill Definition

**File**: `skill.md`

The main skill file containing:
- YAML frontmatter with activation triggers
- Overview of HIG coverage (174 topics)
- Rich summaries for 30+ major topics
- Complete topic index organized by category
- Search and access patterns
- Usage examples
- Best practices

## Data

**Directory**: `data/`

Contains 174 HTML files downloaded from Apple's official HIG website:
- **Platforms**: iOS, iPadOS, macOS, tvOS, visionOS, watchOS
- **Components**: Buttons, Menus, Alerts, Sheets, Lists, and 35+ more
- **Patterns**: Navigation, Modality, Feedback, Loading, Settings, and 17+ more
- **Technologies**: Apple Pay, Siri, HomeKit, CarPlay, ARKit, and 25+ more
- **Foundations**: Color, Typography, Icons, Layout, Materials, Branding, and more
- **Accessibility**: Comprehensive accessibility and inclusion guidelines

Each topic is in its own subdirectory with an `index.html` file.

## Scraper Script

**File**: `scrape.sh`

Wrapper script that runs the Python scraper to download/update HIG documentation.

**Usage**:
```bash
# From the skill directory
./scrape.sh

# Or from repository root
./packages/claude-plugin/agents/apple-hig-helper/scrape.sh
```

**Note**: The actual Python scraper is at `/workspace/scripts/scrape-apple-hig.py`

## Using the Skill

The skill activates when users ask about:
- Apple design guidelines, HIG
- Platform-specific design (iOS, macOS, visionOS, etc.)
- UI components (buttons, alerts, menus, etc.)
- Accessibility guidelines
- Apple technologies (Apple Pay, Siri, etc.)

**Example queries**:
- "What does HIG say about buttons?"
- "Show me iOS design guidelines"
- "Accessibility best practices from HIG"
- "List all available HIG topics"

## Updating Data

To refresh the HIG documentation:

1. Run the scraper:
   ```bash
   cd /workspace
   ./packages/claude-plugin/agents/apple-hig-helper/scrape.sh
   ```

2. Or use the Python script directly:
   ```bash
   cd /workspace
   uv run scripts/scrape-apple-hig.py
   ```

The scraper will:
- Resume from previous downloads (tracks progress in `.visited.json`)
- Respect rate limits (1 second between requests)
- Save all pages to the `data/` directory
- Take approximately 90 minutes for a full download

## Size

- **Skill file**: 20 KB (576 lines)
- **Data**: 23 MB (174 HTML files)
- **Total**: ~23 MB
