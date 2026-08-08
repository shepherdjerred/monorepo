import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import type { CaptureMetadataChip } from "../domain/quick-capture";
import type { CaptureSeed } from "../domain/quick-capture-seed";
import {
  createCaptureRequest,
  deriveCaptureDraft,
  unparseCaptureChip,
} from "../domain/quick-capture";
import {
  captureSessionFromSeed,
  captureSeedFromRouteParams,
  clearCaptureSeedField,
  resetCaptureSessionForAnother,
  setCaptureSeedProject,
} from "../domain/quick-capture-seed";
import { useTasks } from "../hooks/use-tasks";
import { useSettings } from "../hooks/use-settings";
import { useTip } from "../hooks/use-tip";
import {
  feedbackError,
  feedbackSelection,
  feedbackTaskCreate,
} from "../lib/feedback";
import { QuickCaptureComposer } from "../components/input/QuickCaptureComposer";
import { TipPopover } from "../components/common/TipPopover";
import { typography } from "../styles/typography";
import {
  quickAddCaptureKey,
  quickAddDismissTarget,
} from "../navigation/quick-add-navigation";

type Props = NativeStackScreenProps<RootStackParamList, "QuickAdd">;

export function QuickAddScreen({ route, navigation }: Props) {
  const seedResult = useMemo(
    () => captureSeedFromRouteParams(route.params),
    [route.params],
  );

  if (!seedResult.ok) {
    return (
      <InvalidCaptureSeed
        message={seedResult.error.message}
        onClose={() => {
          dismissQuickAdd(navigation);
        }}
      />
    );
  }

  return (
    <QuickAddCaptureScreen
      key={quickAddCaptureKey(route.key, seedResult.value)}
      seed={seedResult.value}
      navigation={navigation}
    />
  );
}

function dismissQuickAdd(navigation: Props["navigation"]): void {
  if (quickAddDismissTarget(navigation.canGoBack()) === "back") {
    navigation.goBack();
    return;
  }
  navigation.replace("Main");
}

type QuickAddCaptureScreenProps = {
  readonly seed: CaptureSeed;
  readonly navigation: Props["navigation"];
};

function QuickAddCaptureScreen({
  seed,
  navigation,
}: QuickAddCaptureScreenProps) {
  const [session, setSession] = useState(() => captureSessionFromSeed(seed));
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [saveError, setSaveError] = useState<string | undefined>();
  const { createTask, projectOptions, contextNames, tagNames } = useTasks();
  const { colors } = useSettings();
  const nlpTip = useTip("natural-language");

  const draft = useMemo(
    () =>
      deriveCaptureDraft(
        session.text,
        session.literalSources,
        referenceDate,
        session.seed,
      ),
    [session, referenceDate],
  );
  const validationMessage =
    session.text.trim().length > 0 && draft.title.trim().length === 0
      ? "Add a task name before saving these details."
      : undefined;

  const create = useCallback(
    (addAnother: boolean) => {
      if (saving || draft.title.trim().length === 0) return;
      setSaving(true);
      setSaveError(undefined);
      void (async () => {
        const result = await createTask(createCaptureRequest(draft));
        if (!result.ok) {
          feedbackError();
          setSaveError(result.error.message);
          setSaving(false);
          return;
        }
        feedbackTaskCreate();
        if (!addAnother) {
          dismissQuickAdd(navigation);
          return;
        }
        setSession((current) => resetCaptureSessionForAnother(current));
        setReferenceDate(new Date());
        setSaving(false);
        setFocusRequestKey((current) => current + 1);
      })();
    },
    [saving, draft, createTask, navigation],
  );

  const handleCreate = useCallback(() => {
    create(false);
  }, [create]);

  const handleCreateAnother = useCallback(() => {
    create(true);
  }, [create]);

  const handleChange = useCallback((value: string) => {
    setSession((current) => ({ ...current, text: value }));
    setSaveError(undefined);
  }, []);

  const handleChipPress = useCallback((chip: CaptureMetadataChip) => {
    feedbackSelection();
    if (chip.origin === "parsed") {
      setSession((current) => ({
        ...current,
        literalSources: unparseCaptureChip(current.literalSources, chip),
      }));
    } else {
      setSession((current) => ({
        ...current,
        seed: clearCaptureSeedField(current.seed, chip.seedField),
      }));
    }
    setSaveError(undefined);
  }, []);

  const handleProjectChange = useCallback((project: string | undefined) => {
    setSession((current) => ({
      ...current,
      seed: setCaptureSeedProject(current.seed, project),
    }));
    setSaveError(undefined);
  }, []);

  // The Create button sits directly under the input, NOT pinned to the
  // bottom of a KeyboardAvoidingView: KAV's padding goes stale when the
  // connection banner appears mid-session (its layout shift isn't
  // re-measured), which left the bottom-pinned button hidden behind the
  // keyboard — untappable exactly when the user is offline.
  // Keep a concrete native root. Otherwise iOS form-sheet scroll discovery
  // can flatten this wrapper and lay out the focused ScrollView offscreen.
  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      collapsable={false}
    >
      <QuickCaptureComposer
        value={session.text}
        draft={draft}
        onChange={handleChange}
        onChipPress={handleChipPress}
        onProjectChange={handleProjectChange}
        onSave={handleCreate}
        onSaveAndAddAnother={handleCreateAnother}
        saving={saving}
        focusRequestKey={focusRequestKey}
        message={saveError ?? validationMessage}
        projectOptions={projectOptions}
        availableContexts={contextNames}
        availableTags={tagNames}
      />
      <TipPopover
        visible={nlpTip.visible}
        title="Try natural language"
        message={'Type: Plan launch tomorrow p:"Client Work"'}
        onDismiss={nlpTip.dismiss}
      />
    </View>
  );
}

type InvalidCaptureSeedProps = {
  readonly message: string;
  readonly onClose: () => void;
};

function InvalidCaptureSeed({ message, onClose }: InvalidCaptureSeedProps) {
  const { colors } = useSettings();

  return (
    <View
      style={[styles.invalidContainer, { backgroundColor: colors.background }]}
      accessibilityRole="alert"
      testID="quick-add-invalid-seed"
    >
      <Text style={[typography.heading, { color: colors.text }]}>
        Quick Add couldn&apos;t open
      </Text>
      <Text
        style={[
          typography.body,
          styles.invalidMessage,
          { color: colors.textSecondary },
        ]}
      >
        {message}
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.invalidButton,
          { backgroundColor: colors.primary },
          pressed && styles.invalidButtonPressed,
        ]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close Quick Add"
        testID="quick-add-invalid-close"
      >
        <Text style={styles.invalidButtonText}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  invalidContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  invalidMessage: {
    textAlign: "center",
  },
  invalidButton: {
    minWidth: 120,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  invalidButtonPressed: {
    opacity: 0.78,
  },
  invalidButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
});
