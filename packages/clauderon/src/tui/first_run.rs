use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

/// First Run Experience screen
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FREScreen {
    Welcome,
    Features,
    QuickStart,
}

impl FREScreen {
    /// Get the next screen
    pub fn next(self) -> Option<Self> {
        match self {
            Self::Welcome => Some(Self::Features),
            Self::Features => Some(Self::QuickStart),
            Self::QuickStart => None,
        }
    }

    /// Get the previous screen
    pub fn prev(self) -> Option<Self> {
        match self {
            Self::Welcome => None,
            Self::Features => Some(Self::Welcome),
            Self::QuickStart => Some(Self::Features),
        }
    }

    /// Get screen number (1-indexed)
    pub fn number(self) -> usize {
        match self {
            Self::Welcome => 1,
            Self::Features => 2,
            Self::QuickStart => 3,
        }
    }

    /// Get total number of screens
    pub const fn total() -> usize {
        3
    }
}

/// Render the First Run Experience modal
pub fn render(frame: &mut Frame, current_screen: FREScreen, area: Rect) {
    // Center the modal (70% width, 60% height)
    let modal_width = (area.width as f32 * 0.7) as u16;
    let modal_height = (area.height as f32 * 0.6) as u16;
    let modal_x = (area.width.saturating_sub(modal_width)) / 2;
    let modal_y = (area.height.saturating_sub(modal_height)) / 2;

    let modal_area = Rect {
        x: modal_x,
        y: modal_y,
        width: modal_width,
        height: modal_height,
    };

    // Clear the background
    frame.render_widget(Clear, modal_area);

    // Render the appropriate screen
    match current_screen {
        FREScreen::Welcome => render_welcome(frame, modal_area),
        FREScreen::Features => render_features(frame, modal_area),
        FREScreen::QuickStart => render_quick_start(frame, modal_area),
    }
}

/// Render the welcome screen
fn render_welcome(frame: &mut Frame, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(" Welcome to Clauderon ")
        .title_alignment(Alignment::Center);

    let inner = block.inner(area);
    frame.render_widget(block, area);

    // Split into content and footer
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(3)])
        .split(inner);

    // Content
    let content = vec![
        Line::from(""),
        Line::from(vec![Span::styled(
            "Development environments, on demand",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )]),
        Line::from(""),
        Line::from("Clauderon creates isolated development environments"),
        Line::from("with Claude AI integration. Each session includes a"),
        Line::from("full terminal, file system, and AI assistant."),
        Line::from(""),
    ];

    let paragraph = Paragraph::new(content)
        .alignment(Alignment::Center)
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, chunks[0]);

    // Footer with navigation
    let footer = Paragraph::new(Line::from(vec![
        Span::styled("[Enter]", Style::default().fg(Color::Green)),
        Span::raw(" Get Started    "),
        Span::styled("[s]", Style::default().fg(Color::Yellow)),
        Span::raw(" Skip"),
    ]))
    .alignment(Alignment::Center);

    frame.render_widget(footer, chunks[1]);
}

/// Render the features screen
fn render_features(frame: &mut Frame, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(" Key Features ")
        .title_alignment(Alignment::Center);

    let inner = block.inner(area);
    frame.render_widget(block, area);

    // Split into content and footer
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(3)])
        .split(inner);

    // Content
    let content = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("• ", Style::default().fg(Color::Cyan)),
            Span::styled("Sessions", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" - Isolated dev environments"),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("• ", Style::default().fg(Color::Cyan)),
            Span::styled("Agents", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" - Claude AI integration"),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("• ", Style::default().fg(Color::Cyan)),
            Span::styled("Backends", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" - Docker, K8s, native"),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("• ", Style::default().fg(Color::Cyan)),
            Span::styled("Real-time", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" - Live console access"),
        ]),
        Line::from(""),
    ];

    let paragraph = Paragraph::new(content)
        .alignment(Alignment::Center)
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, chunks[0]);

    // Footer with navigation
    let footer = Paragraph::new(Line::from(vec![
        Span::raw("[2/3]      "),
        Span::styled("[→]", Style::default().fg(Color::Green)),
        Span::raw(" Next    "),
        Span::styled("[←]", Style::default().fg(Color::Yellow)),
        Span::raw(" Back    "),
        Span::styled("[s]", Style::default().fg(Color::Yellow)),
        Span::raw(" Skip"),
    ]))
    .alignment(Alignment::Center);

    frame.render_widget(footer, chunks[1]);
}

/// Render the quick start screen
fn render_quick_start(frame: &mut Frame, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan))
        .title(" Quick Start Guide ")
        .title_alignment(Alignment::Center);

    let inner = block.inner(area);
    frame.render_widget(block, area);

    // Split into content and footer
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(3)])
        .split(inner);

    // Content
    let content = vec![
        Line::from(""),
        Line::from("Ready to begin? Here's your first steps:"),
        Line::from(""),
        Line::from(vec![
            Span::styled("1. ", Style::default().fg(Color::Cyan)),
            Span::raw("Press "),
            Span::styled("'n'", Style::default().fg(Color::Yellow)),
            Span::raw(" to create a session"),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("2. ", Style::default().fg(Color::Cyan)),
            Span::raw("Fill in repository and preferences"),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("3. ", Style::default().fg(Color::Cyan)),
            Span::raw("Press "),
            Span::styled("Enter", Style::default().fg(Color::Yellow)),
            Span::raw(" on the session to attach"),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("4. ", Style::default().fg(Color::Cyan)),
            Span::raw("Start coding with Claude!"),
        ]),
        Line::from(""),
    ];

    let paragraph = Paragraph::new(content)
        .alignment(Alignment::Center)
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, chunks[0]);

    // Footer with navigation
    let footer = Paragraph::new(Line::from(vec![
        Span::styled("[n]", Style::default().fg(Color::Green)),
        Span::raw(" Create Session    "),
        Span::styled("[q]", Style::default().fg(Color::Yellow)),
        Span::raw(" Close"),
    ]))
    .alignment(Alignment::Center);

    frame.render_widget(footer, chunks[1]);
}
