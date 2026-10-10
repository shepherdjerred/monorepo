package red.sjer.facet

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import red.sjer.facet.host.*

class FacetViewModel(application: Application) : AndroidViewModel(application) {
    var profiles by mutableStateOf<List<VaultProfile>>(emptyList()); private set
    var selected by mutableStateOf<VaultProfile?>(null); private set
    var snapshot by mutableStateOf<VaultSnapshot?>(null); private set
    var allSnapshot by mutableStateOf<VaultSnapshot?>(null); private set
    var remoteChoices by mutableStateOf<List<RemoteVaultChoice>>(emptyList()); private set
    var pendingActions by mutableStateOf<List<PendingFacetMutation>>(emptyList()); private set
    var needsCode by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var savedNotice by mutableStateOf<FacetSavedNotice?>(null); private set
    var savedMaintenance by mutableStateOf<String?>(null); private set
    var busy by mutableStateOf(false); private set
    var query by mutableStateOf(FacetQuery()); private set
    var syncState by mutableStateOf(""); private set
    var needsStandardConsent by mutableStateOf(false); private set
    var capturePreview by mutableStateOf<JsonObject?>(null); private set
    var capturePreviewInput by mutableStateOf(""); private set
    var capturePreviewOwner by mutableStateOf<String?>(null); private set
    var importedCopySummary by mutableStateOf<String?>(null); private set
    var undoDepth by mutableIntStateOf(0); private set
    var conflicts by mutableStateOf<List<JsonObject>>(emptyList()); private set
    var conflictCursor by mutableStateOf<String?>(null); private set
    var conflictPreview by mutableStateOf<String?>(null); private set
    var resolutionIds by mutableStateOf<List<String>>(emptyList()); private set
    var resolutionHistory by mutableStateOf<JsonObject?>(null); private set
    var undoHead by mutableStateOf<String?>(null); private set
    var admittedCompletions by mutableStateOf<Set<String>>(emptySet()); private set
    internal var completionPresentation by mutableStateOf<FacetCompletionPresentation?>(null); private set
    internal fun clearCompletionPresentation(event: FacetCompletionPresentation) { if (completionPresentation == event) completionPresentation = null }
    internal fun ownsCompletionPresentation(event: FacetCompletionPresentation) = !cleared && foreground && selected?.id == event.profileId && sessionGeneration == event.foregroundGeneration && feedbackEngineGeneration == event.engineGeneration
    var completionFailures by mutableStateOf<Map<String, String>>(emptyMap()); private set
    internal var savedFeedback by mutableStateOf<FacetSavedFeedback?>(null); private set
    private val feedbackCoordinator = FacetFeedbackCoordinator()
    private val feedbackOwners = mutableMapOf<String, Long>()
    private var feedbackEngineGeneration = 1L
    internal var feedbackActive by mutableStateOf(false); private set
    var submittedActions by mutableStateOf<Set<String>>(emptySet()); private set
    private val completionAdmission = FacetCompletionAdmission()
    var remindersEnabled by mutableStateOf(FacetReminders.enabled(application)); private set
    var reminderStatus by mutableStateOf(if (FacetReminders.enabled(application)) "Reminder delivery will refresh when this app is ready." else "Reminders are disabled on this device."); private set
    var pendingReminder by mutableStateOf<FacetReminderRequest?>(null); private set
    private var reminderRefreshRequested = false
    private var reminderRefreshQueued = false
    private lateinit var engine: FacetEngineRunner
    private lateinit var account: ObsidianAccountHost
    private lateinit var mutations: FacetMutationController
    private var generation = 0L
    private var foreground = false
    @Volatile private var cleared = false
    private var foregroundLease = 0L
    private var sessionGeneration = 0L
    private val sessions = mutableMapOf<String, ObsidianReplicaSession>()
    private val preferences = application.getSharedPreferences("facet.presentation", Application.MODE_PRIVATE)
    internal var feedbackPreferenceError by mutableStateOf<String?>(null); private set
    internal var feedbackPreferences by mutableStateOf(try { FacetFeedbackPreferences.read(preferences.all) } catch (failure: IllegalArgumentException) {
        feedbackPreferenceError = failure.message; FacetFeedbackPreferences(haptics = false, sound = false)
    }); private set
    internal var feedbackDiagnostic by mutableStateOf<String?>(null); private set
    internal fun reportFeedbackDiagnostic(value: String?) { feedbackDiagnostic = value }
    private val operations = Mutex()
    private var pendingOperations = 0
    private val actionIds = mutableMapOf<String, String>()
    private var previewGeneration = 0L
    private var savedQuery: JsonObject? = null
    private var visibleQuery: FacetPagedQuery? = null
    private val noticeAuthority = FacetNoticeAuthority()
    private var noticeOwner: FacetNoticeOwner? = null
    private var appliedNoticeOwner: FacetNoticeOwner? = null
    private fun clearNoticePresentation() {
        noticeOwner = null; appliedNoticeOwner = null; savedNotice = null; savedMaintenance = null
    }
    private fun reserveNoticeRequest(): FacetNoticeAdmission = noticeAuthority.begin(::clearNoticePresentation)
    private fun captureNoticeOwner(profileId: String, mutationId: String, request: FacetNoticeAdmission = reserveNoticeRequest()): FacetNoticeOwner {
        val owner = noticeAuthority.capture(request, profileId, mutationId)
        feedbackEngineGeneration = owner.engineGeneration
        feedbackOwners.putIfAbsent(mutationId, if (foreground) sessionGeneration else -1L)
        noticeAuthority.publishIfOwned(owner, selected?.id) { noticeOwner = owner }
        return owner
    }
    private fun ownsNotice(owner: FacetNoticeOwner): Boolean =
        !cleared && noticeOwner == owner && noticeAuthority.owns(owner, selected?.id)
    private suspend fun presentSaved(result: AppliedFacetAction, owner: FacetNoticeOwner, saved: () -> Unit = {}, kind: FacetFeedbackKind = FacetFeedbackKind.SAVED, announce: Boolean = true) {
        check(result.profileId == owner.profileId && result.mutationId == owner.mutationId)
        val epoch = feedbackOwners.remove(result.mutationId)
        val event = feedbackCoordinator.publish(result.profileId, result.mutationId, null, kind,
            owner.engineGeneration, epoch ?: -1L, eligible = announce && !cleared && foreground && epoch == sessionGeneration && selected?.id == result.profileId && result.receipt.getValue("paths").jsonArray.isNotEmpty(), noticeReady = false)
        if (event != null) {
            if (completionPresentation?.mutationId != result.mutationId) completionPresentation = null
            savedFeedback = event
        }
        try { noticeAuthority.publishIfOwned(owner, selected?.id) {
        appliedNoticeOwner = owner
        savedNotice = result.warningMessages.takeIf { it.isNotEmpty() }?.let { FacetSavedNotice(owner, it) }
        savedMaintenance = when {
            result.observationPending -> "Saved. Refresh the vault to update the list."
            result.maintenanceRequired -> "Saved. Local cleanup is still pending."
            else -> null
        }
        saved()
        } } catch (_: java.io.IOException) { if (ownsNotice(owner)) savedMaintenance = "Saved. Draft cleanup could not finish; your original action remains available." }
        if (!cleared && selected?.id == result.profileId) {
            try { loadUndoAuthority(result.profileId) }
            catch (_: java.io.IOException) { if (ownsNotice(owner)) savedMaintenance = "Saved. Undo availability could not be refreshed yet." }
            if (event != null && !cleared && foreground && epoch == sessionGeneration && selected?.id == result.profileId)
                feedbackCoordinator.authorizeNotice(event, undoHead?.takeIf { it == result.mutationId })?.let { savedFeedback = it }
        }
    }

    internal fun consumeSavedFeedback() = feedbackCoordinator.consume(selected?.id, sessionGeneration, foreground, feedbackEngineGeneration)
    internal fun consumeSavedNotice() = feedbackCoordinator.consumeNotice(selected?.id, sessionGeneration, foreground, feedbackEngineGeneration)
    internal fun ownsFeedback(event: FacetSavedFeedback) = !cleared && foreground && selected?.id == event.profileId && feedbackEngineGeneration == event.engineGeneration && sessionGeneration == event.foregroundGeneration
    internal fun setFeedbackPreferences(value: FacetFeedbackPreferences) = work {
        withContext(Dispatchers.IO) { check(preferences.edit().remove("feedback.enabled").putBoolean("feedback.haptics", value.haptics).putBoolean("feedback.sound", value.sound).commit()) }
        feedbackPreferences = value
        feedbackPreferenceError = null
    }
    internal fun undoFeedback(event: FacetSavedFeedback) {
        if (!feedbackCoordinator.mayUndo(event, selected?.id, undoHead)) return
        val owner = captureNoticeOwner(event.profileId, UUID.randomUUID().toString())
        work(owner) {
            val authority = engine.features(event.profileId, buildJsonObject { put("kind", "undo_available") })
            val head = authority.getValue("receiptId").jsonPrimitive.contentOrNull
            if (!feedbackCoordinator.mayUndo(event, selected?.id, head)) throw FacetActionError("This saved change is no longer the latest change to undo. Open the owning vault and review its current Undo action.")
            val command = buildJsonObject { put("kind", "undo"); put("receiptId", requireNotNull(event.undoReceiptId)) }
            applied(event.profileId, command, owner.mutationId, owner)
            if (selected?.id == event.profileId) reload()
            restoreActions()
        }
    }

    init {
        foregroundLease = FacetBackgroundSync.resumeForeground()
        work {
        FacetBackgroundSync.awaitBackgroundDrain()
        engine = FacetEngineRunner.open(application) { candidate -> if (cleared) false else { engine = candidate; true } }
        account = withContext(Dispatchers.IO) { ObsidianAccountHost(application, engine).also { account = it } }
        val receiptSchema = FacetSchema(application.assets.open("facet-engine.schema.json").bufferedReader().use { it.readText() })
        mutations = FacetMutationController(NativeFacetMutationPort(engine), receiptSchema)
        profiles = engine.profiles()
        account.reconcileRemovedProfiles(profiles.map { it.id }.toSet())
        val selectedId = withContext(Dispatchers.IO) { preferences.getString("selectedProfile", null) }
        selected = profiles.firstOrNull { it.id == selectedId } ?: profiles.firstOrNull()
        restoreActions()
        if (foreground) startSessions()
        reload(refreshFiles = true)
    } }

    fun select(profile: VaultProfile) {
        resetSelection(profile)
        work { withContext(Dispatchers.IO) { check(preferences.edit().putString("selectedProfile", profile.id).commit()) }; reload(refreshFiles = true) }
    }
    private fun resetSelection(profile: VaultProfile) {
        reserveNoticeRequest()
        generation++; visibleQuery = null; selected = profile; snapshot = null; allSnapshot = null; syncState = ""; needsStandardConsent = false; completionPresentation = null
        query = FacetQuery(); savedQuery = null; conflicts = emptyList(); conflictCursor = null; conflictPreview = null
        capturePreview = null; capturePreviewOwner = null; capturePreviewInput = ""; previewGeneration++
    }
    fun changeQuery(value: FacetQuery) { val admission = reserveNoticeRequest(); query = value; savedQuery = null; visibleQuery = null; generation++; work(admission = admission) { reload() } }
    fun openView(view: JsonObject) {
        val admission = reserveNoticeRequest()
        savedQuery = view.getValue("view").jsonObject.getValue("query").jsonObject
        query = FacetQuery(viewId = view.getValue("id").jsonPrimitive.content); visibleQuery = null; generation++; work(admission = admission) { reload() }
    }
    fun refresh() {
        val admission = reserveNoticeRequest()
        work(admission = admission) { if (foreground) startSessions(); reload(refreshFiles = true); restoreActions() }
    }

    fun removeProfile(profile: VaultProfile) {
        fenceAccountSessions()
        generation++; visibleQuery = null
        work {
            finishFacetProfileRemoval(
                drain = { stopSessions(); FacetBackgroundSync.awaitBackgroundDrain() },
                remove = { engine.removeProfile(profile.id) },
                detachRights = { account.forgetRemovedProfile(profile.id) },
                reconcile = {
                profiles = engine.profiles()
                if (selected?.id == profile.id && profiles.none { it.id == profile.id }) {
                    selected = null; snapshot = null; allSnapshot = null
                    profiles.firstOrNull()?.let(::resetSelection)
                    withContext(Dispatchers.IO) {
                        val edit = preferences.edit()
                        selected?.let { edit.putString("selectedProfile", it.id) } ?: edit.remove("selectedProfile")
                        check(edit.commit())
                    }
                }
                restoreActions(); reload()
                if (foreground) startSessions()
                requestReminderRefresh()
                }
            )
        }
    }
    fun dismissError() { error = null }

    fun reminderPermissionDenied() { reminderStatus = "Notifications are not permitted. Allow Facet notifications in Android settings, then enable reminders again." }
    fun setReminderEnabled(enabled: Boolean) = work {
        if (enabled && !FacetReminders.permissionGranted(getApplication())) throw FacetActionError("Allow Facet notifications in Android settings, then enable reminders again.")
        FacetReminders.setEnabled(getApplication(), enabled)
        remindersEnabled = FacetReminders.enabled(getApplication())
        reminderStatus = if (remindersEnabled) "Updating this device's reminder schedule…" else "Reminders are disabled on this device."
        if (remindersEnabled) requestReminderRefresh()
    }
    fun requestReminder(value: String) {
        try { pendingReminder = FacetReminderRequest(UUID.randomUUID().toString(), FacetReminderRoute.parse(value)) }
        catch (failure: IllegalArgumentException) { error = failure.message ?: "This reminder link is invalid." }
        catch (_: java.net.URISyntaxException) { error = "This reminder link is malformed." }
    }
    fun dismissReminder(request: FacetReminderRequest) { if (pendingReminder == request) pendingReminder = null }
    fun openReminder(request: FacetReminderRequest, opened: (String, VaultTask) -> Unit) {
        dismissReminder(request)
        work {
            val owner = profiles.singleOrNull { it.id == request.route.profileId } ?: throw FacetActionError("The reminder's vault is no longer registered on this device.")
            resetSelection(owner)
            withContext(Dispatchers.IO) { check(preferences.edit().putString("selectedProfile", owner.id).commit()) }
            val expectedGeneration = generation + 1
            reload(refreshFiles = true)
            if (selected?.id != owner.id || generation != expectedGeneration) throw FacetActionError("Navigation changed while opening this reminder. Open it again to continue.")
            val task = allSnapshot?.tasks?.firstOrNull { it.path == request.route.path } ?: throw FacetActionError("The reminded task is unavailable in its owning vault. It may have moved or been deleted.")
            opened(owner.id, task)
        }
    }

    private fun requestReminderRefresh() {
        reminderRefreshRequested = true
        if (reminderRefreshQueued || !::account.isInitialized || !foreground) return
        reminderRefreshQueued = true
        viewModelScope.launch {
            try {
                do {
                    reminderRefreshRequested = false
                    operations.withLock {
                        if (foreground && FacetReminders.enabled(getApplication())) {
                            if (!FacetReminders.permissionGranted(getApplication())) { reminderPermissionDenied(); return@withLock }
                            val authorized = account.eligibleReminderProfileIds()
                            val owners = profiles.filter { it.kind == "local_folder" || it.id in authorized }.map { it.id }.toSet()
                            val result = FacetReminders.refresh(getApplication(), engine, owners)
                            remindersEnabled = true
                            reminderStatus = "${result.scheduled} reminders scheduled; ${result.beyondBudget} beyond this device's budget; ${result.problemCount} invalid reminders need review."
                        }
                    }
                } while (reminderRefreshRequested && foreground)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                reminderStatus = FacetEngineRunner.expectedReminderFailureMessage(failure) ?: throw failure
            }
            finally { reminderRefreshQueued = false }
        }
    }

    fun importSnapshot(uri: android.net.Uri, name: String) = work {
        val result = engine.importSnapshot(uri, name)
        profiles = engine.profiles()
        select(result.profile)
        importedCopySummary = "Imported ${result.filesCopied} files (${result.bytesCopied} bytes) into ${result.profile.name}. This copy is independent of the source folder."
    }

    fun signIn(email: String, password: String, code: String) {
        fenceAccountSessions(preserveAccountResources = true)
        work {
        stopSessions()
        val response = withAccountSessionRecovery(
            attempt = { account.signIn(email, password, code) },
            shouldResume = { foreground && !cleared },
            resume = { startSessions(account.authorizedProfileIds()) },
        )
        when (response) {
            AccountSignIn.NeedsCode -> needsCode = true
            AccountSignIn.CodeRejected -> { needsCode = true; error = "The verification code was rejected. Enter a new code." }
            is AccountSignIn.Vaults -> { needsCode = false; remoteChoices = response.choices }
        }
        requestReminderRefresh()
        }
    }
    fun discoverVaults() = work {
        when (val response = account.restoreChoices()) {
            is AccountSignIn.Vaults -> remoteChoices = response.choices
            null -> throw FacetActionError("Sign in to Obsidian to authorize a vault.")
            else -> throw FacetActionError("Complete Obsidian sign-in before choosing a vault.")
        }
    }
    fun signOut() {
        fenceAccountSessions()
        work { stopSessions(); account.signOut(); remoteChoices = emptyList(); needsCode = false; syncState = "Signed out. Your replicas and pending actions remain on this device."; requestReminderRefresh() }
    }
    fun connect(choice: RemoteVaultChoice, password: String?) = work {
        val profile = account.connect(choice.id, password)
        profiles = engine.profiles(); selected = profile; snapshot = null; allSnapshot = null; remoteChoices = emptyList(); query = FacetQuery(); savedQuery = null
        withContext(Dispatchers.IO) { check(preferences.edit().putString("selectedProfile", profile.id).commit()) }
        if (foreground) startSessions()
        reload()
    }
    fun reauthorize(profileId: String, choice: RemoteVaultChoice, password: String?) {
        fenceAccountSessions()
        work {
        stopSessions()
        account.reauthorize(profileId, choice.id, password)
        profiles = engine.profiles(); remoteChoices = emptyList()
        if (foreground) startSessions()
        if (selected?.id == profileId) reload()
        }
    }
    fun readConflicts(more: Boolean = false) {
        val profile = selected ?: return
        val after = if (more) conflictCursor ?: return else null
        work {
            val page = engine.conflictsPage(profile.id, after)
            if (selected?.id != profile.id) return@work
            val rows = page.getValue("conflicts").jsonArray.map { it.jsonObject }
            conflicts = if (more) conflicts + rows else rows
            conflictCursor = page.getValue("nextCursor").jsonPrimitive.contentOrNull
        }
    }
    fun previewConflict(profileId: String, conflict: JsonObject, version: String) = work {
        val metadata = conflict.getValue(version)
        if (metadata == JsonNull) { conflictPreview = "This version represents a deleted file."; return@work }
        val info = metadata.jsonObject
        if (info.getValue("size").jsonPrimitive.content.toULong() > 1_048_576uL || !conflict.getValue("path").jsonPrimitive.content.endsWith(".md", ignoreCase = true)) {
            conflictPreview = "Binary version: ${info.getValue("size").jsonPrimitive.content} bytes · ${info.getValue("revision").jsonPrimitive.content}"; return@work
        }
        val bytes = requireNotNull(engine.conflictPayload(profileId, conflict.getValue("id").jsonPrimitive.content, version))
        conflictPreview = bytes.toString(Charsets.UTF_8)
    }
    fun resolveConflict(profileId: String, conflict: JsonObject, choice: String, newPath: String, replacement: String?, mutationId: String, saved: () -> Unit) = mutationWork { request ->
        val owner = captureNoticeOwner(profileId, mutationId, request)
        val command = buildJsonObject {
            put("kind", "resolve_conflict"); put("conflictId", conflict.getValue("id"))
            put("expectedRevisions", buildJsonObject {
                listOf("base", "local", "remote").forEach { key -> put(key, conflict.getValue(key).let { if (it == JsonNull) JsonNull else it.jsonObject.getValue("revision") }) }
                put("current", conflict.getValue("currentRevision"))
            })
            put("resolution", buildJsonObject {
                put("kind", choice)
                if (choice == "keep_both") put("newPath", newPath)
                if (choice == "replace_payload") put("deleted", replacement == null)
            })
        }
        if (choice == "replace_payload") {
            val receipt = engine.executePayload(profileId, command, mutationId, replacement?.toByteArray(Charsets.UTF_8))
            check(receipt.getValue("mutationId").jsonPrimitive.content == mutationId && receipt.getValue("applied").jsonPrimitive.boolean)
            val result = mutations.observeApplied(profileId, mutationId, receipt) { reconcileUndo(profileId, mutationId, command) }
            presentSaved(result, owner, saved)
        } else applied(profileId, command, mutationId, owner, saved)
        if (selected?.id == profileId) { reload(); readConflicts() }
        restoreActions()
    }
    fun readResolution(mutationId: String) {
        val profile = selected ?: return
        work {
            val result = engine.features(profile.id, buildJsonObject { put("kind", "resolution_history"); put("mutationId", mutationId) })
            if (selected?.id == profile.id) resolutionHistory = result
        }
    }
    fun undoResolution(mutationId: String) {
        val profile = selected ?: return
        command(profile.id, buildJsonObject { put("kind", "undo"); put("receiptId", mutationId) })
    }
    fun retireRejected(action: PendingFacetMutation) = work { engine.retireRejectedMutation(action.mutationId); restoreActions() }

    fun preview(profileId: String, input: String) {
        val request = ++previewGeneration
        val context = query
        capturePreview = null
        capturePreviewOwner = null
        work {
            val result = engine.features(profileId, buildJsonObject {
                put("kind", "capture_preview"); put("input", input); put("at", Instant.now().toString()); put("today", LocalDate.now().toString())
                put("context", buildJsonObject {
                    put("projects", strings(context.projects)); put("contexts", strings(context.contexts)); put("tags", strings(context.tags))
                    if (context.scope == "today") put("scheduled", LocalDate.now().toString())
                })
            })
            if (request == previewGeneration && selected?.id == profileId) { capturePreview = result; capturePreviewInput = input; capturePreviewOwner = profileId }
        }
    }
    fun create(profileId: String, preview: JsonObject, mutationId: String, saved: () -> Unit) {
      val owner = captureNoticeOwner(profileId, mutationId)
      work(owner) {
        applied(profileId, buildJsonObject { put("kind", "create"); put("properties", preview.getValue("properties")); put("body", preview.getValue("body")) }, mutationId, owner, saved)
        if (selected?.id == profileId) reload(); restoreActions()
      }
    }
    fun update(profileId: String, task: VaultTask, draft: TaskEditorDraft, mutationId: String, saved: () -> Unit) {
      val owner = captureNoticeOwner(profileId, mutationId)
      work(owner) {
        applied(profileId, draft.command(task), mutationId, owner, saved)
        if (selected?.id == profileId) reload(); restoreActions()
      }
    }
    fun delete(profileId: String, task: VaultTask, saved: () -> Unit) = command(profileId, buildJsonObject { put("kind", "delete"); put("path", task.path); put("expectedRevision", task.revision) }, saved = saved)
    fun toggle(profileId: String, task: VaultTask, saved: () -> Unit = {}) {
        if (task.isRecurring && task.occurrenceDate == null) { error = "Open Today or Agenda to choose a recurring occurrence."; return }
        val intent = completionAdmission.admit(profileId, task) ?: return
        admittedCompletions = admittedCompletions + intent.key
        completionFailures = completionFailures - intent.key
        val owner = captureNoticeOwner(profileId, intent.mutationId)
        work(owner) {
            try {
                check(completionAdmission.owns(intent)) { "This completion is no longer admitted." }
                applied(intent.profileId, intent.command, intent.mutationId, owner, saved) { result ->
                    if (result.receipt.getValue("paths").jsonArray.isNotEmpty() && foreground && feedbackOwners[intent.mutationId] == sessionGeneration && selected?.id == intent.profileId)
                        completionPresentation = FacetCompletionPresentation(intent.profileId, intent.mutationId, task, !task.completed, sessionGeneration, owner.engineGeneration)
                }
                if (selected?.id == intent.profileId) reload()
                restoreActions()
            } catch (failure: Exception) {
                if (failure !is CancellationException) {
                    completionFailures = completionFailures + (intent.key to FacetEngineRunner.failureMessage(failure))
                    try { restoreActions() } catch (recoveryFailure: Exception) { failure.addSuppressed(recoveryFailure) }
                }
                throw failure
            } finally {
                completionAdmission.release(intent)
                admittedCompletions = admittedCompletions - intent.key
            }
        }
    }
    fun move(profileId: String, task: VaultTask, status: String) = command(profileId, buildJsonObject { put("kind", "set_status"); put("path", task.path); put("expectedRevision", task.revision); put("status", status); task.occurrenceDate?.let { put("occurrenceDate", it) } })
    internal fun viewIntent(existing: JsonObject? = null): FacetSavedViewIntent {
        val profile = requireNotNull(selected)
        val viewQuery = savedQuery ?: query.document().let { JsonObject(it - "offset" - "limit" - "today" - "at") }
        val previous = existing?.getValue("view")?.jsonObject ?: JsonObject(emptyMap())
        return FacetSavedViewIntent(profile.id, existing?.getValue("id")?.jsonPrimitive?.content ?: UUID.randomUUID().toString(),
            viewQuery, previous, previous["name"]?.jsonPrimitive?.content.orEmpty())
    }
    internal fun saveView(intent: FacetSavedViewIntent, saved: () -> Unit = {}) {
        if (intent.mutationId in submittedActions || pendingActions.any { it.mutationId == intent.mutationId }) return
        mutationWork { request ->
            applied(intent.profileId, intent.command, intent.mutationId, captureNoticeOwner(intent.profileId, intent.mutationId, request), saved)
            if (selected?.id == intent.profileId) reload()
            restoreActions()
        }
    }
    fun duplicateView(view: JsonObject) = ownerMutationWork { profile, request ->
        val id = UUID.randomUUID().toString()
        val original = view.getValue("view").jsonObject
        val copied = JsonObject(original + ("name" to JsonPrimitive(original.getValue("name").jsonPrimitive.content + " copy")))
        val command = buildJsonObject { put("kind", "save_view"); put("id", id); put("view", copied) }
        val mutationId = actionId(profile.id, command)
        applied(profile.id, command, mutationId, captureNoticeOwner(profile.id, mutationId, request)); clearAction(profile.id, command); if (selected?.id == profile.id) reload(); restoreActions()
    }
    fun deleteView(view: JsonObject) {
        val profile = requireNotNull(selected); val id = view.getValue("id").jsonPrimitive.content
        if (query.viewId == id) { query = FacetQuery(scope = "all"); savedQuery = null }
        command(profile.id, buildJsonObject { put("kind", "delete_view"); put("id", id) })
    }
    fun moveView(view: JsonObject, index: Int) {
        val profile = requireNotNull(selected)
        val ids = allSnapshot?.views?.map { it.getValue("id").jsonPrimitive.content }?.toMutableList() ?: return
        val id = view.getValue("id").jsonPrimitive.content; check(ids.remove(id)); ids.add(index.coerceIn(0, ids.size), id)
        command(profile.id, buildJsonObject { put("kind", "reorder_views"); put("ids", strings(ids)) })
    }
    fun restoreViews() { val profile = requireNotNull(selected); command(profile.id, buildJsonObject { put("kind", "restore_default_views") }) }
    fun bulk(profileId: String, tasks: List<VaultTask>, action: String, value: String = "", saved: () -> Unit = {}) {
        if (cleared || selected?.id != profileId || tasks.isEmpty()) return
        val command = try { bulkCommand(tasks, action, value) }
        catch (failure: FacetBulkSelectionError) { reserveNoticeRequest(); error = failure.message; return }
        command(profileId, command, saved)
    }
    fun undo() = ownerMutationWork { profile, request ->
        val retained = readPendingActions(profile.id).filter { it.mutation.getValue("command").jsonObject.getValue("kind").jsonPrimitive.content == "undo" }
        check(retained.size <= 1) { "Review the saved Undo actions in Settings before continuing." }
        if (retained.isNotEmpty()) {
            val action = retained.single()
            val owner = captureNoticeOwner(action.profileId, action.mutationId, request)
            val result = mutations.resume(action) { reconcileUndo(action.profileId, action.mutationId, action.mutation.getValue("command").jsonObject) }
            presentSaved(result, owner, announce = false)
            if (selected?.id == profile.id) reload(); restoreActions(); return@ownerMutationWork
        }
        val available = engine.features(profile.id, buildJsonObject { put("kind", "undo_available") })
        val head = available.getValue("receiptId").jsonPrimitive.contentOrNull ?: throw FacetActionError("There is no saved change to undo in this vault.")
        val command = buildJsonObject { put("kind", "undo"); put("receiptId", head) }
        val id = actionId(profile.id, command)
        applied(profile.id, command, id, captureNoticeOwner(profile.id, id, request)); clearAction(profile.id, command)
        if (selected?.id == profile.id) reload(); restoreActions()
    }
    fun resume(action: PendingFacetMutation) {
      val owner = captureNoticeOwner(action.profileId, action.mutationId)
      work(owner) {
        val result = mutations.resume(action) { reconcileUndo(action.profileId, action.mutationId, action.mutation.getValue("command").jsonObject) }
        presentSaved(result, owner, announce = false)
        if (selected?.id == result.profileId) reload()
        restoreActions()
      }
    }
    private fun command(profileId: String, command: JsonObject, saved: () -> Unit = {}) {
        val id = actionId(profileId, command)
        val owner = captureNoticeOwner(profileId, id)
      work(owner) {
        applied(profileId, command, id, owner, saved); clearAction(profileId, command)
        if (selected?.id == profileId) reload(); restoreActions()
      }
    }
    private fun actionId(profileId: String, command: JsonObject) = actionIds.getOrPut("$profileId:$command") { UUID.randomUUID().toString() }
    private fun clearAction(profileId: String, command: JsonObject) { actionIds.remove("$profileId:$command") }
    private suspend fun applied(profileId: String, command: JsonObject, mutationId: String, owner: FacetNoticeOwner, saved: () -> Unit = {}, receiptPresentation: (AppliedFacetAction) -> Unit = {}) {
        // Host verifies the applied receipt. Observe/persist undo before clearing the immutable draft.
        val admitted = java.util.concurrent.atomic.AtomicBoolean(false)
        val result = try {
            mutations.submit(profileId, command, mutationId, admitted = { admitted.set(true) }) {
                reconcileUndo(profileId, mutationId, command)
            }
        } catch (failure: Exception) {
            if (admitted.get() && failure !is CancellationException) {
                submittedActions = submittedActions + mutationId
                try { restoreActions() } catch (recoveryFailure: Exception) { failure.addSuppressed(recoveryFailure) }
            }
            throw failure
        }
        receiptPresentation(result)
        val kind = feedbackKind(command)
        presentSaved(result, owner, saved, kind)
    }
    private fun readUndo(profileId: String): FacetUndoHistory {
        val current = preferences.getString("undoHistory.$profileId", null)
        if (current != null) return FacetUndoHistory.read(Json.parseToJsonElement(current).jsonObject)
        val legacy = Json.parseToJsonElement(preferences.getString("undo.$profileId", "[]")!!).jsonArray.map { it.jsonPrimitive.content }
        return FacetUndoHistory(legacy)
    }
    private suspend fun reconcileUndo(profileId: String, mutationId: String, command: JsonObject) = withContext(Dispatchers.IO) {
        val previous = readUndo(profileId)
        val next = previous.reconcile(mutationId, command)
        if (next != previous && !preferences.edit().putString("undoHistory.$profileId", next.document().toString()).commit())
            throw java.io.IOException("The applied action remains retained because Undo history could not be saved.")
    }
    private suspend fun readPendingActions(profileId: String? = null): List<PendingFacetMutation> {
        val actions = mutableListOf<PendingFacetMutation>(); var after: String? = null
        do {
            val page = engine.pendingMutations(profileId = profileId, afterId = after)
            actions.addAll(page)
            if (page.size < 128) break
            val next = page.last().mutationId
            check(after?.let { next > it } != false) { "Pending action cursor did not advance." }
            after = next
        } while (true)
        return actions
    }
    private suspend fun restoreActions() {
        pendingActions = readPendingActions()
        selected?.id?.let { loadUndoAuthority(it) }
        resolutionIds = selected?.id?.let { id -> withContext(Dispatchers.IO) { readUndo(id).resolutions } } ?: emptyList()
    }
    fun loadMore() = work {
        val profile = selected ?: return@work
        val previous = snapshot ?: return@work
        val request = generation
        val frozen = visibleQuery ?: return@work
        if (!frozen.owns(profile.id, request)) return@work
        val next = engine.snapshot(profile.id, frozen.page(previous.tasks.size))
        if (request != generation || selected?.id != profile.id) return@work
        if (next.version != previous.version || next.totalCount != previous.totalCount) throw FacetActionError("The vault changed between pages. Refresh to read one consistent task list.")
        check(next.tasks.isNotEmpty() || previous.tasks.size.toULong() == previous.totalCount) { "The engine returned an incomplete page." }
        check((previous.tasks.size + next.tasks.size).toULong() <= previous.totalCount) { "The engine returned too many task rows." }
        snapshot = next.copy(tasks = previous.tasks + next.tasks, groups = previous.groups + next.groups)
    }
    private suspend fun reload(refreshFiles: Boolean = false) {
        val profile = selected ?: return
        val request = ++generation
        val frozen = FacetPagedQuery.capture(profile.id, request, query, savedQuery)
        visibleQuery = null
        val cached = engine.cachedSnapshot(profile.id, frozen.page())
        if (request != generation || selected?.id != profile.id) return
        snapshot = cached
        visibleQuery = frozen
        if (refreshFiles) engine.refresh(profile.id)
        val result = engine.snapshot(profile.id, frozen.page())
        if (request != generation || selected?.id != result.profileId) return
        snapshot = result
        if (result.configuration == null) {
            val discovery = engine.features(profile.id, buildJsonObject { put("kind", "discovery") })
            needsStandardConsent = profile.kind != "obsidian_sync" || discovery.getValue("initialSyncComplete").jsonPrimitive.boolean
            allSnapshot = result; requestReminderRefresh(); return
        }
        needsStandardConsent = false
        val all = mutableListOf<VaultTask>(); var page: VaultSnapshot; var total: ULong? = null
        val vocabulary = FacetPagedQuery(profile.id, request, FacetQuery(scope = "all").document(today = frozen.query.getValue("today").jsonPrimitive.content, at = frozen.query.getValue("at").jsonPrimitive.content))
        do {
            page = engine.snapshot(profile.id, vocabulary.page(all.size, 1000))
            if (request != generation || selected?.id != profile.id) return
            if (page.version != result.version) throw FacetActionError("The vault changed while reading its task vocabulary. Refresh to continue.")
            if (total != null && total != page.totalCount) throw FacetActionError("The task vocabulary changed between pages. Refresh to continue.")
            total = page.totalCount
            check(page.tasks.isNotEmpty() || all.size.toULong() == page.totalCount) { "The engine returned an incomplete vault page." }
            all.addAll(page.tasks)
            check(all.size.toULong() <= page.totalCount) { "The engine returned too many vault rows." }
        } while (all.size.toULong() < page.totalCount)
        allSnapshot = page.copy(tasks = all)
        loadUndoAuthority(profile.id)
        requestReminderRefresh()
    }
    private suspend fun loadUndoAuthority(profileId: String) {
        val available = engine.features(profileId, buildJsonObject { put("kind", "undo_available") })
        if (selected?.id == profileId) {
            undoHead = available.getValue("receiptId").jsonPrimitive.contentOrNull
            undoDepth = if (available.getValue("canUndo").jsonPrimitive.boolean) 1 else 0
        }
    }
    fun approveStandard() = ownerWork { profile -> engine.approveStandard(profile); profiles = engine.profiles(); if (selected?.id == profile.id) selected = profiles.single { it.id == profile.id }; engine.refresh(profile.id); if (selected?.id == profile.id) reload() }
    fun resumeSync() {
        if (cleared) return
        val admission = reserveNoticeRequest()
        foregroundLease = FacetBackgroundSync.resumeForeground()
        foreground = true
        feedbackActive = true
        sessionGeneration++
        if (::account.isInitialized) work(admission = admission) { startSessions(); requestReminderRefresh() }
    }
    fun pauseSync() {
        if (cleared) return
        val admission = reserveNoticeRequest()
        val lease = foregroundLease
        foreground = false
        feedbackActive = false
        completionPresentation = null
        sessionGeneration++
        sessions.values.forEach { it.requestStop() }
        work(admission = admission) {
            stopSessions()
            if (!foreground && !cleared) FacetBackgroundSync.pauseForeground(getApplication(), lease)
        }
    }
    private fun fenceAccountSessions(preserveAccountResources: Boolean = false) {
        reserveNoticeRequest()
        if (!preserveAccountResources) {
            FacetReminders.fence()
            FacetBackgroundSync.cancel(getApplication())
        }
        sessionGeneration++
        sessions.values.forEach { it.requestStop() }
    }
    private suspend fun stopSessions() {
        val affected = sessions.values.toList(); sessions.clear()
        var failure: Exception? = null
        withContext(NonCancellable) { affected.forEach { try { it.stop() } catch (error: Exception) { if (failure == null) failure = error } } }
        failure?.let { throw it }
    }
    private suspend fun startSessions(authorizedProfiles: Set<String>? = null) {
        if (cleared || !foreground) return
        FacetBackgroundSync.awaitBackgroundDrain()
        if (cleared || !foreground) return
        val ownerGeneration = sessionGeneration
        for (profile in profiles.filter { it.kind == "obsidian_sync" && (authorizedProfiles == null || it.id in authorizedProfiles) }) {
            if (cleared || !foreground || ownerGeneration != sessionGeneration) break
            if (sessions.containsKey(profile.id)) continue
            var retained: ObsidianReplicaSession? = null
            var opened = false
            try {
                ObsidianReplicaSession.open(engine, account, profile.id,
                    changed = { withContext(Dispatchers.Main) { if (foreground && ownerGeneration == sessionGeneration && selected?.id == profile.id) { reserveNoticeRequest(); reload() } } },
                    state = { status -> withContext(Dispatchers.Main) { if (foreground && ownerGeneration == sessionGeneration && selected?.id == profile.id) syncState = status } },
                    retain = { candidate ->
                        if (cleared || !foreground || ownerGeneration != sessionGeneration || sessions.containsKey(profile.id)) false
                        else { retained = candidate; sessions[profile.id] = candidate; true }
                    })
                opened = true
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (selected?.id == profile.id) syncState = FacetEngineRunner.failureMessage(failure) }
            finally {
                if (!opened && sessions[profile.id] === retained) sessions.remove(profile.id)
                if (retained != null && (!foreground || ownerGeneration != sessionGeneration)) {
                    retained.requestStop()
                }
            }
        }
    }
    private fun work(owner: FacetNoticeOwner? = null, admission: FacetNoticeAdmission? = owner?.let { FacetNoticeAdmission(it.requestGeneration, it.engineGeneration) }, block: suspend () -> Unit) {
        if (cleared) return
        val ticket = admission ?: reserveNoticeRequest()
        pendingOperations++; busy = true
        viewModelScope.launch {
            try { operations.withLock { block() } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                val applied = appliedNoticeOwner
                val ownApplied = applied != null && ownsNotice(applied) && ticket == FacetNoticeAdmission(applied.requestGeneration, applied.engineGeneration)
                val currentAction = !cleared && noticeAuthority.isCurrent(ticket) && (owner == null || ownsNotice(owner))
                val presentation = FacetWorkFailure.present(failure, ownApplied, currentAction)
                presentation?.let {
                    if (failure is java.io.IOException && ownApplied) savedMaintenance = it
                    else error = it
                }
            }
            finally { pendingOperations--; busy = pendingOperations > 0 }
        }
    }
    private fun ownerWork(block: suspend (VaultProfile) -> Unit) {
        val owner = selected ?: return
        work { block(owner) }
    }
    private fun mutationWork(block: suspend (FacetNoticeAdmission) -> Unit) {
        val request = reserveNoticeRequest()
        work(admission = request) { block(request) }
    }
    private fun ownerMutationWork(block: suspend (VaultProfile, FacetNoticeAdmission) -> Unit) {
        val profile = selected ?: return
        mutationWork { request -> block(profile, request) }
    }

    override fun onCleared() {
        val lease = foregroundLease
        cleared = true; foreground = false; feedbackActive = false; generation++; sessionGeneration++
        completionAdmission.close(); admittedCompletions = emptySet()
        noticeAuthority.close(::clearNoticePresentation)
        sessions.values.forEach { it.requestStop() }
        FacetBackgroundSync.retireForegroundWriter {
            operations.withLock {
                var failure: Throwable? = null
                try { stopSessions() } catch (error: Throwable) { failure = error }
                if (::account.isInitialized) try { account.close() } catch (error: Throwable) { if (failure == null) failure = error else failure.addSuppressed(error) }
                if (::engine.isInitialized) try { engine.close() } catch (error: Throwable) { if (failure == null) failure = error else failure.addSuppressed(error) }
                failure?.let { throw it }
                FacetBackgroundSync.pauseForeground(getApplication(), lease)
            }
        }
        super.onCleared()
    }
}
