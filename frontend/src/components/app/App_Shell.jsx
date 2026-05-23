import { useApp } from '../../context/App_Context';
import { SearchBox } from '../Search_Box';
import { Sidebar } from '../Sidebar';
import { ShabloneScreen } from '../Shablone_Screen';
import { YandexMap } from '../Yandex_Map';
import { ZoneMapMenu } from '../Zone_Map_Menu';
import { WorkspaceOnboarding } from '../Workspace_Onboarding';
import { DroneModal } from '../Drone_OnClick_List_Sidebar';
import { DroneParking } from '../Drone_Parking';
import { WeatherWidget } from '../Weather_Widget';
import {
  VIEW_TRANSITION_MS,
  EXIT_PANELS_MS,
  DESKTOP_SWITCH_EASE,
} from '../../constants/app';
import { Confirm_Dialog } from './Confirm_Dialog';
import { Mobile_Panel_Backdrop } from './Mobile_Panel_Backdrop';
import { App_Account_Bar } from './App_Account_Bar';
import { App_Brand_Header } from './App_Brand_Header';
import { Ai_Cloud_Notice } from './Ai_Cloud_Notice';
import { Zone_Rect_Draw_Panel } from './Zone_Rect_Draw_Panel';
import { Template_Editor_Panel } from './Template_Editor_Panel';
import { Template_Apply_Banner } from './Template_Apply_Banner';
import { Drone_Placement_Banner } from './Drone_Placement_Banner';
import { Mobile_Workspace_Nav } from './Mobile_Workspace_Nav';

export function App_Shell() {
  const app = useApp();
  const {
    workspaceVisible,
    hasStarted,
    exitingToTemplates,
    setExitingToTemplates,
    setHasStarted,
    missionTemplates,
    confirmUi,
    resolveConfirm,
    templateEditMode,
    templateDraftPath,
    templateDraftShiftSegments,
    templateDraftName,
    setTemplateDraftName,
    saveTemplateDraft,
    cancelTemplateEdit,
    undoTemplateDraftPoint,
    toggleDrawRectZoneMode,
    drawRectZoneMode,
    draftRectBoundary,
    newRectZoneName,
    setNewRectZoneName,
    draftRectZoneColor,
    handleDraftRectZoneColorChange,
    saveDraftRectZone,
    rectZoneBusy,
    zoneKmlBusy,
    editingZoneId,
    cancelDraftRectZone,
    noTransitionTemplateSwitch,
    handleStart,
    startCreateTemplate,
    startEditTemplateRoute,
    handleDeleteTemplateFromMenu,
    templateCascadeCountById,
    templateCascadeMetaById,
    drones,
    mapCenter,
    mapZoom,
    setMapCenter,
    setMapZoom,
    handleMapClick,
    handleZoneClickToEdit,
    handleDraftRectBoundaryChange,
    handleRectDrawComplete,
    handleTemplateRoutePathChange,
    toggleTemplateDraftShiftSegment,
    zonesForMap,
    activeZoneBoundary,
    activeZoneColor,
    zoneFitNonce,
    zoneMapMessageOverlay,
    handleWeatherFlightConditions,
    handleDronePositionChange,
    selectedDroneForSidebar,
    droneFocusRequest,
    isRouteEditMode,
    selectedRouteEditPath,
    handleRoutePathChange,
    selectedRouteShiftSegments,
    toggleRouteShiftSegment,
    workspaceOnboardingStepId,
    templateToApplyId,
    placementMode,
    droneToPlace,
    cancelTemplatePreview,
    confirmApplyTemplateToSelectedDrone,
    backendZones,
    activeZoneId,
    applyActiveZoneId,
    handleDeleteZoneFromMenu,
    templateUsageByZoneId,
    handleDeleteActiveZone,
    workspaceTourOpen,
    handleOnboardingBeforeStep,
    handleWorkspaceTourOpenChange,
    cancelDronePlacement,
    selectedDroneForModal,
    setSelectedDroneForModal,
    globalMissionLog,
    aiResultsForSidebar,
    deleteAiResultForMission,
    deleteAllAiResults,
    sidebarTab,
    setSidebarTab,
    getActiveFlights,
    startDroneFlight,
    pauseDroneFlight,
    resumeDroneFlight,
    stopDroneFlight,
    stopAllFlights,
    addRoutePoint,
    undoLastPoint,
    clearRoute,
    clearLogs,
    handleSelectDroneForSidebar,
    handleToggleRouteMode,
    centerMapToFirstWaypoint,
    flyDroneToFirstWaypoint,
    weatherFlightSafe,
    weatherFlightReasons,
    isDroneAtMissionStart,
    workZoneReady,
    authUserLabel,
    handleLogout,
    isTemplateCreationMode,
    aiCloudNoticeUi,
    setAiCloudNotice,
    openBushesPanelForMission,
    sidebarOpen,
    parkingOpen,
    setSidebarOpen,
    setParkingOpen,
    startDronePlacement,
    removeDroneFromMap,
    createDroneFromParking,
    handleDroneClick,
  } = app;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-transparent text-white px-2 sm:px-3 py-2 sm:py-3">
      <Mobile_Panel_Backdrop
        open={sidebarOpen || parkingOpen}
        onClose={() => { setSidebarOpen(false); setParkingOpen(false); }}
      />
      {confirmUi && (
        <Confirm_Dialog confirmUi={confirmUi} onResolve={resolveConfirm} />
      )}
      {authUserLabel && !isTemplateCreationMode && (
        <App_Account_Bar authUserLabel={authUserLabel} onLogout={handleLogout} />
      )}
      {!isTemplateCreationMode && <App_Brand_Header />}

      {workspaceVisible && aiCloudNoticeUi.notice && (
        <Ai_Cloud_Notice
          notice={aiCloudNoticeUi.notice}
          visible={aiCloudNoticeUi.visible}
          exiting={aiCloudNoticeUi.exiting}
          onDismiss={() => setAiCloudNotice(null)}
          onOpenPanel={() => {
            openBushesPanelForMission(aiCloudNoticeUi.notice.missionId);
            setAiCloudNotice(null);
          }}
        />
      )}

      <div className={`flex flex-1 min-h-0 overflow-hidden ${isTemplateCreationMode ? '' : 'gap-2 lg:gap-3 flex-col lg:flex-row'}`}>
        {!isTemplateCreationMode && (
          <div
            className={`fixed left-0 top-0 bottom-0 z-50 w-[85%] max-w-sm flex h-full min-h-0 flex-col transform transition-transform duration-300 ease-out lg:relative lg:w-72 lg:max-w-none lg:flex-shrink-0 ${
              workspaceVisible
                ? `${parkingOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} opacity-100`
                : 'pointer-events-none translate-x-[100vw] opacity-0'
            }`}
            style={{
              transitionDuration: `${VIEW_TRANSITION_MS}ms`,
              transitionTimingFunction: DESKTOP_SWITCH_EASE,
              paddingTop: 'env(safe-area-inset-top, 0px)',
            }}
          >
            <div className="flex h-full min-h-0 flex-col pt-[72px]">
              <div className="min-h-0 flex-1">
                <DroneParking
                  drones={drones}
                  onPlaceDrone={startDronePlacement}
                  onRemoveDrone={removeDroneFromMap}
                  onCreateDrone={createDroneFromParking}
                  onDroneClick={handleDroneClick}
                  onBackToTemplates={() => {
                    setExitingToTemplates(true);
                    setParkingOpen(false);
                    setTimeout(() => {
                      setHasStarted(false);
                      setExitingToTemplates(false);
                    }, EXIT_PANELS_MS);
                  }}
                  onClose={() => setParkingOpen(false)}
                />
              </div>
            </div>
          </div>
        )}
        <main className={`flex-1 bg-transparent flex flex-col min-w-0 min-h-0 ${isTemplateCreationMode ? 'p-0 rounded-none' : 'p-2 sm:p-3 rounded'}`}>
          {templateEditMode ? (
            <div className="flex-1 flex flex-col min-h-0 relative">
              <div className="flex-1 min-h-0">
                <YandexMap
                  drones={[]}
                  mapCenter={mapCenter}
                  mapZoom={mapZoom}
                  onMapClick={handleMapClick}
                  onZoneClick={drawRectZoneMode || draftRectBoundary ? handleZoneClickToEdit : undefined}
                  onDraftRectBoundaryChange={handleDraftRectBoundaryChange}
                  onRectDrawComplete={handleRectDrawComplete}
                  editingPath={null}
                  routeEditMode={!drawRectZoneMode && !draftRectBoundary}
                  routeEditPath={templateDraftPath}
                  onRoutePathChange={handleTemplateRoutePathChange}
                  routeShiftSegmentIndices={templateDraftShiftSegments}
                  onRouteShiftSegmentToggle={toggleTemplateDraftShiftSegment}
                  forceResize={false}
                  zones={zonesForMap}
                  zoneBoundary={activeZoneBoundary}
                  zoneColor={activeZoneColor}
                  zoneFitNonce={zoneFitNonce}
                  draftRectBoundary={draftRectBoundary}
                  drawRectZoneMode={drawRectZoneMode}
                />
                {zoneMapMessageOverlay}
              </div>
              <Zone_Rect_Draw_Panel
                drawRectZoneMode={drawRectZoneMode}
                draftRectBoundary={draftRectBoundary}
                newRectZoneName={newRectZoneName}
                onZoneNameChange={setNewRectZoneName}
                draftRectZoneColor={draftRectZoneColor}
                onColorChange={handleDraftRectZoneColorChange}
                onSave={saveDraftRectZone}
                onCancel={cancelDraftRectZone}
                saveDisabled={rectZoneBusy || zoneKmlBusy}
                cancelDisabled={rectZoneBusy}
                editingZoneId={editingZoneId}
              />
              <Template_Editor_Panel
                templateEditMode={templateEditMode}
                templateDraftPath={templateDraftPath}
                templateDraftName={templateDraftName}
                onTemplateNameChange={setTemplateDraftName}
                drawRectZoneMode={drawRectZoneMode}
                onToggleDrawRectZone={toggleDrawRectZoneMode}
                onUndoPoint={undoTemplateDraftPoint}
                onSave={saveTemplateDraft}
                onCancel={cancelTemplateEdit}
              />
            </div>
          ) : (
            <div className="flex-1 relative min-h-0 overflow-visible">
              <div
                className={`absolute inset-0 flex items-center justify-center transition-transform will-change-transform ${
                  workspaceVisible
                    ? 'pointer-events-none -translate-x-[100vw]'
                    : 'translate-x-0'
                }`}
                style={{
                  transitionDuration: noTransitionTemplateSwitch ? '0ms' : `${VIEW_TRANSITION_MS}ms`,
                  transitionTimingFunction: DESKTOP_SWITCH_EASE,
                }}
              >
                <ShabloneScreen
                  onStart={handleStart}
                  templates={missionTemplates}
                  onStartCreateTemplate={startCreateTemplate}
                  onEditTemplateRoute={startEditTemplateRoute}
                  onDeleteTemplate={handleDeleteTemplateFromMenu}
                  templateCascadeCountById={templateCascadeCountById}
                  templateCascadeMetaById={templateCascadeMetaById}
                />
              </div>
              <div
                className={`absolute inset-0 flex flex-col min-h-0 transition-transform will-change-transform ${
                  workspaceVisible
                    ? 'translate-x-0'
                    : 'pointer-events-none translate-x-[100vw]'
                }`}
                style={{
                  transitionDuration: noTransitionTemplateSwitch ? '0ms' : `${VIEW_TRANSITION_MS}ms`,
                  transitionTimingFunction: DESKTOP_SWITCH_EASE,
                }}
              >
            <div className="w-full flex flex-col gap-2 flex-1 min-h-0">
              <div className="flex flex-col gap-2 mb-2 relative z-[1100]">
                <div className="flex flex-col lg:flex-row gap-2 lg:items-start">
                  <div className="flex-1 min-w-0">
                    <SearchBox
                      setMapCenter={setMapCenter}
                      setMapZoom={setMapZoom}
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 relative min-h-0">
                <Zone_Rect_Draw_Panel
                  drawRectZoneMode={drawRectZoneMode}
                  draftRectBoundary={draftRectBoundary}
                  newRectZoneName={newRectZoneName}
                  onZoneNameChange={setNewRectZoneName}
                  draftRectZoneColor={draftRectZoneColor}
                  onColorChange={handleDraftRectZoneColorChange}
                  onSave={saveDraftRectZone}
                  onCancel={cancelDraftRectZone}
                  saveDisabled={rectZoneBusy || zoneKmlBusy}
                  cancelDisabled={rectZoneBusy}
                  editingZoneId={editingZoneId}
                  showDeleteZone
                  onDeleteZone={handleDeleteActiveZone}
                  deleteDisabled={
                    activeZoneId == null ||
                    rectZoneBusy ||
                    zoneKmlBusy ||
                    Number(templateUsageByZoneId[String(activeZoneId)] || 0) > 0
                  }
                  templateUsageCount={Number(templateUsageByZoneId[String(activeZoneId)] || 0)}
                />
                <div className="absolute top-2 right-2 z-[100] flex justify-end">
                  <div className="relative flex items-start gap-2">
                    <button
                      type="button"
                      data-onboarding="zone-draw"
                      onClick={toggleDrawRectZoneMode}
                      title={drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
                      aria-label={drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
                      className={`shrink-0 w-11 h-11 rounded-lg text-white text-xl leading-none flex items-center justify-center border ${
                        drawRectZoneMode
                          ? 'bg-amber-900 border-amber-500 ring-2 ring-amber-400/70'
                          : 'bg-amber-950/90 border-amber-800 hover:bg-amber-900'
                      }`}
                    >
                      {drawRectZoneMode ? '×' : '▭'}
                    </button>
                    <WeatherWidget
                      className="shrink-0"
                      latitude={mapCenter[0]}
                      longitude={mapCenter[1]}
                      onFlightConditionsChange={handleWeatherFlightConditions}
                    />
                  </div>
                </div>
                <YandexMap
                  drones={drones}
                  mapCenter={mapCenter}
                  mapZoom={mapZoom}
                  onMapClick={handleMapClick}
                  onZoneClick={handleZoneClickToEdit}
                  onDraftRectBoundaryChange={handleDraftRectBoundaryChange}
                  onRectDrawComplete={handleRectDrawComplete}
                  onMapCenterChange={setMapCenter}
                  onMapZoomChange={setMapZoom}
                  onDronePositionChange={handleDronePositionChange}
                  selectedDroneId={selectedDroneForSidebar}
                  focusRequest={droneFocusRequest}
                  forceResize={true}
                  routeEditMode={isRouteEditMode}
                  routeEditPath={selectedRouteEditPath}
                  onRoutePathChange={handleRoutePathChange}
                  routeShiftSegmentIndices={selectedRouteShiftSegments}
                  onRouteShiftSegmentToggle={toggleRouteShiftSegment}
                  workspaceOnboardingStepId={workspaceOnboardingStepId}
                  previewPath={templateToApplyId ? (missionTemplates.find(t => t.id === templateToApplyId)?.path) ?? null : null}
                  zones={zonesForMap}
                  zoneBoundary={activeZoneBoundary}
                  zoneColor={activeZoneColor}
                  zoneFitNonce={zoneFitNonce}
                  draftRectBoundary={draftRectBoundary}
                  drawRectZoneMode={drawRectZoneMode}
                  placementMode={placementMode && droneToPlace != null}
                />
                {templateToApplyId && (
                  <Template_Apply_Banner
                    onCancel={cancelTemplatePreview}
                    onConfirm={confirmApplyTemplateToSelectedDrone}
                    confirmDisabled={selectedDroneForSidebar == null}
                  />
                )}
                {zoneMapMessageOverlay}
                <ZoneMapMenu
                  zones={backendZones}
                  activeZoneId={activeZoneId}
                  onSelectZone={applyActiveZoneId}
                  onDeleteZone={handleDeleteZoneFromMenu}
                  zoneTemplateUsageById={templateUsageByZoneId}
                  deleteBusy={rectZoneBusy || zoneKmlBusy}
                  showEmptyMenuDuringTour={workspaceTourOpen && backendZones.length === 0}
                />
                {workspaceVisible && hasStarted && (
                  <WorkspaceOnboarding
                    enabled
                    onBeforeStep={handleOnboardingBeforeStep}
                    onTourOpenChange={handleWorkspaceTourOpenChange}
                    layoutKey={`${sidebarOpen}-${parkingOpen}-${workspaceTourOpen}`}
                  />
                )}
                {placementMode && droneToPlace && (
                  <Drone_Placement_Banner
                    droneLabel={(() => {
                      const d = drones.find((x) => x.id === droneToPlace);
                      return d ? ` «${d.name}»` : '';
                    })()}
                    onCancel={cancelDronePlacement}
                  />
                )}
              </div>

              <Mobile_Workspace_Nav
                onOpenParking={() => { setParkingOpen(true); setSidebarOpen(false); }}
                onBackToTemplates={() => {
                  setExitingToTemplates(true);
                  setParkingOpen(false);
                  setSidebarOpen(false);
                  setTimeout(() => {
                    setHasStarted(false);
                    setExitingToTemplates(false);
                  }, EXIT_PANELS_MS);
                }}
                onOpenSidebar={() => { setSidebarOpen(true); setParkingOpen(false); }}
              />
            </div>
              </div>
            </div>
          )}
        </main>

        {!isTemplateCreationMode && (
          <div
            className={`fixed right-0 top-0 bottom-0 z-50 transform transition-transform duration-300 ease-out lg:relative lg:flex-shrink-0 ${
              workspaceTourOpen && sidebarOpen
                ? 'w-[min(calc(100vw-12px),28rem)] max-w-none lg:w-80 lg:max-w-none'
                : 'w-[85%] max-w-sm lg:w-80 lg:max-w-none'
            } ${
              workspaceVisible
                ? `${sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'} opacity-100`
                : 'pointer-events-none translate-x-[100vw] opacity-0'
            }`}
            style={{
              transitionDuration: `${VIEW_TRANSITION_MS}ms`,
              transitionTimingFunction: DESKTOP_SWITCH_EASE,
              paddingTop: 'env(safe-area-inset-top, 0px)',
            }}
          >
            <div className="flex h-full min-h-0 flex-col pt-[72px]">
              <div className="min-h-0 flex-1">
                <Sidebar
                  dronesData={drones}
                  selectedDroneId={selectedDroneForSidebar}
                  onSelectDrone={handleSelectDroneForSidebar}
                  suspendAutoSelectDrone={Boolean(templateToApplyId)}
                  missionLog={globalMissionLog}
                  aiResults={aiResultsForSidebar}
                onDeleteAiMissionResult={deleteAiResultForMission}
                onDeleteAllAiMissionResults={deleteAllAiResults}
                  initialTab={sidebarTab}
                  onTabChange={setSidebarTab}
                  onOpenAiMission={openBushesPanelForMission}
                  activeFlights={getActiveFlights()}
                  onStartFlight={startDroneFlight}
                  onPauseFlight={pauseDroneFlight}
                  onResumeFlight={resumeDroneFlight}
                  onStopFlight={stopDroneFlight}
                  onStopAllFlights={stopAllFlights}
                  onAddRoutePoint={addRoutePoint}
                  onUndoLastPoint={undoLastPoint}
                  onClearRoute={clearRoute}
                  onClearLogs={clearLogs}
                  onDroneClick={handleDroneClick}
                  isRouteEditMode={isRouteEditMode}
                  onToggleRouteMode={handleToggleRouteMode}
                  onCenterToFirstWaypoint={centerMapToFirstWaypoint}
                  onFlyToFirstWaypoint={flyDroneToFirstWaypoint}
                  flightAllowedByWeather={weatherFlightSafe}
                  weatherFlightReasons={weatherFlightReasons}
                  isDroneAtMissionStart={isDroneAtMissionStart}
                  workZoneReady={workZoneReady}
                  instructionTourActive={workspaceTourOpen}
                  onClose={() => setSidebarOpen(false)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedDroneForModal && (
        <DroneModal
          drone={selectedDroneForModal}
          onClose={() => setSelectedDroneForModal(null)}
        />
      )}

      {false && hasStarted && (
        <footer
          className={`mt-2 bg-gradient-to-r from-gray-700 to-gray-800 p-3 rounded text-center text-white transition-all ease-in-out ${
            exitingToTemplates ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100 translate-y-0'
          }`}
          style={{ transitionDuration: exitingToTemplates ? `${EXIT_PANELS_MS}ms` : `${VIEW_TRANSITION_MS}ms` }}
        >
          <div className="md:flex-row justify-between items-center">
            <div>
              © 2026 Система управления дронами.
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
