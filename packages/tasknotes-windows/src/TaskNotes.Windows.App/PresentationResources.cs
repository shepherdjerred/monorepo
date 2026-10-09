using Microsoft.UI.Xaml;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App;

/// <summary>Shared dimensions become WinUI resources; semantic brushes retain Windows theme/high-contrast behavior.</summary>
internal static class PresentationResources
{
    internal static void Install(ResourceDictionary resources)
    {
        var tokens = PresentationTokens.Bundled();
        resources["ConfiguredColorConverter"] = new ConfiguredColorConverter();
        resources["FacetRowPadding"] = new Thickness(
            tokens.Number("spacing", "sm"),
            tokens.Number("desktop", "rowVerticalPadding"),
            tokens.Number("spacing", "sm"),
            tokens.Number("desktop", "rowVerticalPadding")
        );
        resources["FacetInspectorPadding"] = new Thickness(tokens.Number("spacing", "lg"));
        resources["FacetHitTarget"] = tokens.Number("hitTargets", "desktop");
        resources["FacetRowHeight"] =
            tokens.Number("hitTargets", "desktop")
            + 2 * tokens.Number("desktop", "rowVerticalPadding");
        resources["FacetDateColumn"] = tokens.Number("desktop", "dateColumnMin");
        resources["FacetBodySize"] = tokens.Number("typography", "bodySmall", "size");
        resources["FacetCaptionSize"] = tokens.Number("typography", "caption", "size");
        resources["FacetChipRadius"] = new CornerRadius(tokens.Number("radii", "small"));
        foreach (string role in tokens.ColorRoles)
            _ = SemanticBrush(role); // Missing or unknown roles fail before a window is created.
    }

    internal static string SemanticBrush(string role) =>
        role switch
        {
            "brand" => "AccentTextFillColorPrimaryBrush",
            "background" => "ApplicationPageBackgroundThemeBrush",
            "surface" => "CardBackgroundFillColorDefaultBrush",
            "surfaceElevated" => "LayerFillColorDefaultBrush",
            "text" => "TextFillColorPrimaryBrush",
            "textSecondary" => "TextFillColorSecondaryBrush",
            "textTertiary" => "TextFillColorTertiaryBrush",
            "separator" => "DividerStrokeColorDefaultBrush",
            "success" => "SystemFillColorSuccessBrush",
            "warning" => "SystemFillColorCautionBrush",
            "error" => "SystemFillColorCriticalBrush",
            _ => throw new InvalidDataException($"Unsupported presentation color role {role}."),
        };
}
