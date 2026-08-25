import { formOptions } from "@tanstack/react-form";
import type { z } from "zod";
import {
  CompetitionVisibilitySchema,
  getAllSeasons,
  visibilityDescription,
  visibilityToString,
} from "@scout-for-lol/data";
import {
  Field,
  FieldDescription,
  FieldError,
  FormSection,
  Label,
} from "@scout-for-lol/design-system/components/input";
import { ChampionCombobox } from "#src/components/champion-combobox.tsx";
import {
  COMPETITION_CRITERIA_OPTIONS,
  RANKED_COMPETITION_QUEUES,
  criteriaForGameVariant,
  isRankCriterion,
  queueOptionsForVariant,
} from "#src/components/competition-criteria-fields.tsx";
import { CompetitionQueueFields } from "#src/components/competition-queue-fields.tsx";
import { TimezoneSelect } from "#src/components/timezone-select.tsx";
import {
  fieldErrorMessage,
  withScoutForm,
} from "#src/components/semantic-form.tsx";
import { browserTimezone } from "#src/lib/competition-time.ts";
import type { CompetitionFormValueSchema } from "#src/lib/form-schemas.ts";

export type FormState = z.input<typeof CompetitionFormValueSchema>;

export const EMPTY_STATE: FormState = {
  title: "",
  description: "",
  channelId: "",
  visibility: "OPEN",
  maxParticipants: "100",
  gameVariant: "MODERN",
  analysisTimezone: browserTimezone(),
  dates: { mode: "FIXED_DATES", startDate: "", endDate: "", seasonId: "" },
  criteria: {
    criteriaType: "MOST_GAMES_PLAYED",
    queues: ["ALL"],
    aggregation: "MAX",
    championId: "",
    minGames: "10",
  },
};

export const competitionFormOptions = formOptions({
  defaultValues: EMPTY_STATE,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "America/Los_Angeles",
});

type CompetitionFormFieldsProps = {
  locked: boolean;
  channels: { id: string; name: string }[] | undefined;
};

const DEFAULT_PROPS: CompetitionFormFieldsProps = {
  locked: false,
  channels: undefined,
};

export const CompetitionFormFields = withScoutForm({
  ...competitionFormOptions,
  props: DEFAULT_PROPS,
  render: function CompetitionFormFieldsContent(props) {
    const { form, locked } = props;
    const now = new Date();
    const seasons = getAllSeasons().filter((season) => season.endDate >= now);

    return (
      <div className="space-y-5">
        {locked ? (
          <p className="rounded-md border border-border bg-scout-hover/40 p-3 text-sm text-scout-ink">
            This competition has started. Criteria, dates, game version, and
            visibility are locked. You can still edit its basics and increase
            the participant cap.
          </p>
        ) : null}

        <FormSection
          legend="Competition basics"
          description="Name the competition and choose where Scout announces it."
        >
          <form.AppField name="title">
            {(field) => (
              <field.TextField
                id="competition-title"
                label="Title"
                autoComplete="off"
                maxLength={100}
                required
              />
            )}
          </form.AppField>
          <form.AppField name="description">
            {(field) => (
              <field.TextareaField
                id="competition-description"
                label="Description"
                autoComplete="off"
                maxLength={500}
                required
              />
            )}
          </form.AppField>
          <form.AppField name="channelId">
            {(field) => (
              <field.NativeSelectField
                id="competition-channel"
                label="Announcement channel"
                placeholder="Pick a channel"
                options={(props.channels ?? []).map((channel) => ({
                  value: channel.id,
                  label: `#${channel.name}`,
                }))}
                required
              />
            )}
          </form.AppField>
          <div className="grid gap-3 sm:grid-cols-2">
            <form.AppField name="visibility">
              {(field) => (
                <field.NativeSelectField
                  id="competition-visibility"
                  label="Visibility"
                  options={CompetitionVisibilitySchema.options.map((value) => ({
                    value,
                    label: visibilityToString(value),
                  }))}
                  disabled={locked}
                  required
                />
              )}
            </form.AppField>
            <form.AppField name="maxParticipants">
              {(field) => (
                <field.TextField
                  id="competition-max"
                  label="Max participants"
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={100}
                  step={1}
                  required
                />
              )}
            </form.AppField>
          </div>
          <form.Subscribe selector={(state) => state.values.visibility}>
            {(visibility) => (
              <output
                htmlFor="competition-visibility"
                className="text-sm text-scout-subtle"
              >
                {visibilityDescription(visibility)}
              </output>
            )}
          </form.Subscribe>
        </FormSection>

        <FormSection
          legend="Schedule"
          description="Choose fixed calendar dates or use a League season."
          disabled={locked}
        >
          <form.AppField name="dates.mode">
            {(field) => (
              <field.NativeSelectField
                id="competition-dates-mode"
                label="Schedule type"
                options={[
                  { value: "FIXED_DATES", label: "Fixed dates" },
                  { value: "SEASON", label: "League season dates" },
                ]}
                required
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.dates.mode}>
            {(mode) =>
              mode === "FIXED_DATES" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <form.AppField name="dates.startDate">
                      {(field) => (
                        <field.TextField
                          id="competition-start"
                          label="Start date"
                          type="date"
                          required
                        />
                      )}
                    </form.AppField>
                    <form.AppField name="dates.endDate">
                      {(field) => (
                        <field.TextField
                          id="competition-end"
                          label="End date"
                          type="date"
                          required
                        />
                      )}
                    </form.AppField>
                  </div>
                  <form.AppField name="analysisTimezone">
                    {(field) => {
                      const error = field.state.meta.isTouched
                        ? fieldErrorMessage(field.state.meta.errors)
                        : undefined;
                      return (
                        <Field>
                          <Label htmlFor="competition-timezone">
                            Competition timezone
                          </Label>
                          <TimezoneSelect
                            id="competition-timezone"
                            name={field.name}
                            value={field.state.value}
                            onChange={field.handleChange}
                            onBlur={field.handleBlur}
                            required
                            {...(error === undefined
                              ? {}
                              : {
                                  ariaInvalid: true,
                                  ariaDescribedBy: "competition-timezone-error",
                                })}
                          />
                          <FieldDescription>
                            Fixed dates run from 12:00 AM on the first day
                            through 11:59 PM on the last day in this timezone.
                          </FieldDescription>
                          {error === undefined ? null : (
                            <FieldError id="competition-timezone-error">
                              {error}
                            </FieldError>
                          )}
                        </Field>
                      );
                    }}
                  </form.AppField>
                </>
              ) : (
                <form.AppField name="dates.seasonId">
                  {(field) => (
                    <field.NativeSelectField
                      id="competition-season"
                      label="Season"
                      description="This sets the dates only; the game version and queues determine which matches count."
                      placeholder="Pick a season"
                      options={seasons.map((season) => ({
                        value: season.id,
                        label: `${season.displayName} (${dateFormatter.format(
                          season.startDate,
                        )} – ${dateFormatter.format(season.endDate)})`,
                      }))}
                      required
                    />
                  )}
                </form.AppField>
              )
            }
          </form.Subscribe>
          <form.Subscribe selector={(state) => state.values.dates.seasonId}>
            {(seasonId) => {
              const season = seasons.find(
                (candidate) => candidate.id === seasonId,
              );
              return season === undefined ? null : (
                <output
                  htmlFor="competition-season"
                  className="text-sm text-scout-subtle"
                >
                  <time dateTime={season.startDate.toISOString()}>
                    {dateFormatter.format(season.startDate)}
                  </time>{" "}
                  through{" "}
                  <time dateTime={season.endDate.toISOString()}>
                    {dateFormatter.format(season.endDate)}
                  </time>
                </output>
              );
            }}
          </form.Subscribe>
        </FormSection>

        <FormSection
          legend="Ranking criteria"
          description="Choose the game version, metric, and eligible queues for the leaderboard."
          disabled={locked}
        >
          <form.AppField name="gameVariant">
            {(field) => (
              <field.NativeSelectField
                id="competition-game-variant"
                label="Game version"
                options={[
                  { value: "MODERN", label: "Modern League" },
                  { value: "CLASSIC", label: "League Classic" },
                ]}
                onValueChange={(value) => {
                  if (value === "MODERN" || value === "CLASSIC") {
                    form.setFieldValue(
                      "criteria",
                      criteriaForGameVariant(form.state.values.criteria, value),
                    );
                  }
                }}
                required
              />
            )}
          </form.AppField>
          <form.Subscribe
            selector={(state) => ({
              gameVariant: state.values.gameVariant,
              criteriaType: state.values.criteria.criteriaType,
              queues: state.values.criteria.queues,
            })}
          >
            {({ gameVariant, criteriaType, queues }) => {
              const criteriaOptions =
                gameVariant === "CLASSIC"
                  ? COMPETITION_CRITERIA_OPTIONS.filter(
                      (option) => !isRankCriterion(option.value),
                    )
                  : COMPETITION_CRITERIA_OPTIONS;
              const options = isRankCriterion(criteriaType)
                ? RANKED_COMPETITION_QUEUES
                : queueOptionsForVariant(gameVariant);
              return (
                <>
                  <form.AppField name="criteria.criteriaType">
                    {(field) => (
                      <field.NativeSelectField
                        id="criteria-type"
                        label="Criteria"
                        options={criteriaOptions}
                        required
                      />
                    )}
                  </form.AppField>
                  {criteriaType === "MOST_WINS_CHAMPION" ? (
                    <form.AppField name="criteria.championId">
                      {(field) => {
                        const error = field.state.meta.isTouched
                          ? fieldErrorMessage(field.state.meta.errors)
                          : undefined;
                        return (
                          <Field>
                            <Label htmlFor="criteria-champion">Champion</Label>
                            <ChampionCombobox
                              id="criteria-champion"
                              name={field.name}
                              value={field.state.value}
                              gameVariant={gameVariant}
                              onChange={field.handleChange}
                              required
                              {...(error === undefined
                                ? {}
                                : {
                                    ariaInvalid: true,
                                    ariaDescribedBy: "criteria-champion-error",
                                  })}
                            />
                            {error === undefined ? null : (
                              <FieldError id="criteria-champion-error">
                                {error}
                              </FieldError>
                            )}
                          </Field>
                        );
                      }}
                    </form.AppField>
                  ) : null}
                  {criteriaType === "HIGHEST_WIN_RATE" ? (
                    <form.AppField name="criteria.minGames">
                      {(field) => (
                        <field.TextField
                          id="criteria-min-games"
                          label="Minimum games"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          required
                        />
                      )}
                    </form.AppField>
                  ) : null}
                  <form.AppField name="criteria.queues">
                    {(field) => {
                      const error = field.state.meta.isTouched
                        ? fieldErrorMessage(field.state.meta.errors)
                        : undefined;
                      return (
                        <CompetitionQueueFields
                          name={field.name}
                          value={field.state.value}
                          options={options}
                          error={error}
                          onBlur={field.handleBlur}
                          onChange={field.handleChange}
                        />
                      );
                    }}
                  </form.AppField>
                  {isRankCriterion(criteriaType) && queues.length > 1 ? (
                    <form.AppField name="criteria.aggregation">
                      {(field) => (
                        <field.NativeSelectField
                          id="criteria-aggregation"
                          label="Rank scoring"
                          options={[
                            { value: "MAX", label: "Best selected rank" },
                            { value: "SUM", label: "Combined ranks" },
                          ]}
                          required
                        />
                      )}
                    </form.AppField>
                  ) : null}
                </>
              );
            }}
          </form.Subscribe>
          <FieldDescription>
            Season selection controls the date window. Game version and queues
            control which matches count.
          </FieldDescription>
        </FormSection>
      </div>
    );
  },
});
