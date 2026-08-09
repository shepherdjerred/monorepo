import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { MenuView } from "@react-native-menu/menu";
import type { MenuAction } from "@react-native-menu/menu";

import type { SavedView } from "../../domain/saved-views";
import { useSettings } from "../../hooks/use-settings";
import { typography } from "../../styles/typography";
import { AppIcon } from "../common/AppIcon";
import type {
  BrowseItem,
  DestinationItem,
  DimensionItem,
  SavedViewItem,
} from "./browse-model";
import { savedViewTaskCountLabel, taskCountLabel } from "./browse-model";
import { SavedViewIcon } from "./SavedViewIcon";

function actionImage(image: string): Pick<MenuAction, "image"> {
  return Platform.OS === "ios" ? { image } : {};
}

function savedViewActions(
  view: SavedView,
  views: readonly SavedView[],
  isSaving: boolean,
): MenuAction[] {
  const index = views.findIndex((candidate) => candidate.id === view.id);
  return [
    {
      id: "edit",
      title: "Edit View",
      attributes: { disabled: isSaving },
      ...actionImage("pencil"),
    },
    {
      id: "favorite",
      title: view.favorite ? "Remove from Favorites" : "Add to Favorites",
      state: view.favorite ? "on" : "off",
      attributes: { disabled: isSaving },
      ...actionImage(view.favorite ? "star.slash" : "star"),
    },
    {
      id: "duplicate",
      title: "Duplicate",
      attributes: { disabled: isSaving },
      ...actionImage("plus.square.on.square"),
    },
    {
      id: "move-up",
      title: "Move Up",
      attributes: { disabled: isSaving || index <= 0 },
      ...actionImage("arrow.up"),
    },
    {
      id: "move-down",
      title: "Move Down",
      attributes: {
        disabled: isSaving || index === -1 || index >= views.length - 1,
      },
      ...actionImage("arrow.down"),
    },
    {
      id: "delete",
      title: "Delete View",
      attributes: { destructive: true, disabled: isSaving },
      ...actionImage("trash"),
    },
  ];
}

type Props = {
  readonly item: BrowseItem;
  readonly views: readonly SavedView[];
  readonly isSaving: boolean;
  readonly onOpenSavedView: (id: string) => void;
  readonly onSavedViewAction: (view: SavedView, action: string) => void;
  readonly onCreateView: () => void;
  readonly onOpenDimension: (
    dimension: DimensionItem["dimension"],
    value: string,
  ) => void;
  readonly onOpenDestination: (
    destination: DestinationItem["destination"],
  ) => void;
};

function SavedViewRow({
  item,
  views,
  isSaving,
  onOpenSavedView,
  onSavedViewAction,
}: Pick<
  Props,
  "views" | "isSaving" | "onOpenSavedView" | "onSavedViewAction"
> & { readonly item: SavedViewItem }) {
  const { colors } = useSettings();
  const countLabel = savedViewTaskCountLabel(item.view, item.count);
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.background, borderColor: colors.borderLight },
      ]}
    >
      <Pressable
        style={styles.rowMain}
        onPress={() => {
          onOpenSavedView(item.view.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.view.name}, ${countLabel}`}
        accessibilityHint="Opens this saved view"
        testID={`saved-view-${item.view.id}`}
      >
        <View style={[styles.icon, { backgroundColor: `${item.view.tint}1a` }]}>
          <SavedViewIcon
            symbol={item.view.symbol}
            size={20}
            color={item.view.tint}
          />
        </View>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text
              style={[typography.body, styles.rowTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {item.view.name}
            </Text>
            {item.view.favorite ? (
              <AppIcon name="star" size={13} color={item.view.tint} />
            ) : null}
          </View>
          <Text
            style={[typography.bodySmall, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {countLabel} · {item.view.presentation.layout}
          </Text>
        </View>
      </Pressable>
      <MenuView
        title={item.view.name}
        actions={savedViewActions(item.view, views, isSaving)}
        onPressAction={({ nativeEvent }) => {
          onSavedViewAction(item.view, nativeEvent.event);
        }}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        testID={`saved-view-menu-${item.view.id}`}
      >
        <View
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${item.view.name}`}
        >
          <AppIcon
            name="more-horizontal"
            size={21}
            color={colors.textSecondary}
          />
        </View>
      </MenuView>
    </View>
  );
}

export function BrowseRow({ item, ...callbacks }: Props) {
  const { colors } = useSettings();
  if (item.kind === "saved-view") {
    return <SavedViewRow item={item} {...callbacks} />;
  }
  if (item.kind === "empty") {
    return (
      <View
        style={[
          styles.emptyRow,
          {
            backgroundColor: colors.background,
            borderColor: colors.borderLight,
          },
        ]}
      >
        <Text style={[typography.bodySmall, { color: colors.textTertiary }]}>
          {item.message}
        </Text>
      </View>
    );
  }
  if (item.kind === "new-view") {
    return (
      <Pressable
        style={[
          styles.row,
          styles.actionRow,
          {
            backgroundColor: colors.background,
            borderColor: colors.borderLight,
          },
        ]}
        onPress={callbacks.onCreateView}
        disabled={callbacks.isSaving}
        accessibilityRole="button"
        accessibilityState={{ disabled: callbacks.isSaving }}
        accessibilityLabel="Create saved view"
        testID="create-saved-view"
      >
        <View style={[styles.icon, { backgroundColor: colors.surface }]}>
          <AppIcon name="plus" size={20} color={colors.primary} />
        </View>
        <Text style={[typography.body, { color: colors.primary }]}>
          New Saved View
        </Text>
      </Pressable>
    );
  }

  const isDimension = item.kind === "dimension";
  const prefix =
    isDimension && item.dimension === "context"
      ? "@"
      : isDimension && item.dimension === "tag"
        ? "#"
        : "";
  const title = isDimension ? `${prefix}${item.name}` : item.title;
  const subtitle = isDimension
    ? item.dimension === "project" && item.value !== item.name
      ? `${taskCountLabel(item.count)} · ${item.value}`
      : taskCountLabel(item.count)
    : item.subtitle;
  const icon = isDimension
    ? item.dimension === "project"
      ? "folder"
      : item.dimension === "context"
        ? "at-sign"
        : "hash"
    : item.icon;

  return (
    <Pressable
      style={[
        styles.row,
        styles.actionRow,
        { backgroundColor: colors.background, borderColor: colors.borderLight },
      ]}
      onPress={() => {
        if (item.kind === "dimension") {
          callbacks.onOpenDimension(item.dimension, item.value);
        } else {
          callbacks.onOpenDestination(item.destination);
        }
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      testID={
        item.kind === "dimension"
          ? `browse-${item.key}`
          : `browse-${item.destination}`
      }
    >
      <View style={[styles.icon, { backgroundColor: colors.surface }]}>
        <AppIcon name={icon} size={19} color={colors.textSecondary} />
      </View>
      <View style={styles.copy}>
        <Text
          style={[typography.body, styles.rowTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={[typography.bodySmall, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {subtitle}
        </Text>
      </View>
      <AppIcon name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    paddingLeft: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionRow: { paddingRight: 14 },
  rowMain: {
    minHeight: 64,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  copy: { flex: 1, minWidth: 0, marginRight: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { flexShrink: 1, fontWeight: "500" },
  menuButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyRow: {
    minHeight: 52,
    justifyContent: "center",
    marginHorizontal: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
