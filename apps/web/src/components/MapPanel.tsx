import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import maplibregl, { type ExpressionSpecification } from "maplibre-gl";
import regions from "../data/regions.england_1492.json";
import { useAppState } from "../state/appStore";

const MODES = ["Political", "Economic", "Military", "Unrest"] as const;
const BASE_URL = import.meta.env.BASE_URL ?? "/";
const ASSET_BASE = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
const withBase = (path: string) => `${ASSET_BASE}${path.replace(/^\//, "")}`;
const LAND_LOCAL_PATH = withBase("data/geo/ne_110m_land.geojson");
const COASTLINE_LOCAL_PATH = withBase("data/geo/ne_110m_coastline.geojson");
const COUNTRIES_LOCAL_PATH = withBase("data/geo/ne_110m_admin_0_countries.geojson");
const LAND_REMOTE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";
const COASTLINE_REMOTE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson";
const COUNTRIES_REMOTE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

const GEO_PACKS: Record<string, {
  id: string;
  name: string;
  boundariesLocalPath: string;
  boundariesRemoteUrl: string;
  featureIdProperty: string;
  ownerProperty: string;
  useBoundariesForCountries?: boolean;
  nationIdProperty?: string;
  useRegionAssignments?: boolean;
  usePolityPalette?: boolean;
}> = {
  ne_admin0_v1: {
    id: "ne_admin0_v1",
    name: "Natural Earth Admin-0",
    boundariesLocalPath: withBase("data/geo/ne_110m_admin_0_countries.geojson"),
    boundariesRemoteUrl: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    featureIdProperty: "ADMIN",
    ownerProperty: "ADMIN"
  },
  world_1492: {
    id: "world_1492",
    name: "World 1492",
    boundariesLocalPath: withBase("data/geo/scenarios/1492/admin0.geojson"),
    boundariesRemoteUrl: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    featureIdProperty: "ADMIN_1492",
    ownerProperty: "ADMIN_1492",
    useBoundariesForCountries: true,
    nationIdProperty: "nation_id",
    useRegionAssignments: false,
    usePolityPalette: true
  }
};

const DEFAULT_GEO_PACK = "ne_admin0_v1";
const EMPTY_GEOJSON: GeoJsonFeatureCollection = { type: "FeatureCollection", features: [] };
const RELATION_LABELS = {
  crown: "Crown lands",
  subject: "Subject",
  allied: "Allied",
  treaties: "Treaties exist",
  noTreaties: "No treaties",
  enemy: "Enemy"
} as const;

type RegionFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, any>;
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: any;
    };
  }>;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: any[];
};

type RegionAssignment = {
  geoRegionId: string;
  geoRegionKey?: string;
  nationId: string;
};

type HoverInfo = {
  x: number;
  y: number;
  name: string;
  relationLabel: string;
  relationValue: number | null;
  treaties: string[];
  atWar: boolean;
  summary?: string;
  trajectory?: Record<string, number | undefined>;
  stats?: {
    gdp: number;
    treasury: number;
    stability: number;
    population: number;
    literacy: number;
    legitimacy: number;
  };
};

type ModeMetric = {
  label: string;
  min: number;
  max: number;
  legendMin: number;
  legendMax: number;
  colorMin: number;
  colorMax: number;
  values: Record<string, number>;
  palette: [string, string, string];
  format: (value: number) => string;
  transform?: (value: number) => number;
};

export default function MapPanel() {
  const { state, dispatch } = useAppState();
  const [mode, setMode] = useState<(typeof MODES)[number]>("Political");
  const [landData, setLandData] = useState<GeoJsonFeatureCollection>(EMPTY_GEOJSON);
  const [coastlineData, setCoastlineData] = useState<GeoJsonFeatureCollection>(EMPTY_GEOJSON);
  const [countriesData, setCountriesData] = useState<GeoJsonFeatureCollection>(EMPTY_GEOJSON);
  const [boundaryData, setBoundaryData] = useState<GeoJsonFeatureCollection>(EMPTY_GEOJSON);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [mapEpoch, setMapEpoch] = useState(0);
  const [mapRecovering, setMapRecovering] = useState(false);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverDataRef = useRef({
    geoPack: GEO_PACKS[DEFAULT_GEO_PACK],
    playerNationId: "",
    nationNameIndex: new Map<string, string>(),
    nationProfiles: {} as Record<string, { summary: string; trajectory: Record<string, number | undefined>; mapAliases: string[] }>,
    worldNations: {} as Record<string, any>,
    relations: [] as Array<{ from_nation_id: string; to_nation_id: string; value: number; treaties: string[]; at_war: boolean }>
  });

  const regionBounds = useMemo(() => annotateRegions(regions as RegionFeatureCollection, state.scenario), [state.scenario]);
  const geoPack = useMemo(() => {
    const scenarioPack = state.scenario?.geoPack?.id;
    const resolvedPack = scenarioPack === "ne_admin1_v1" ? "ne_admin0_v1" : scenarioPack;
    return GEO_PACKS[resolvedPack ?? ""] ?? GEO_PACKS[DEFAULT_GEO_PACK];
  }, [state.scenario?.geoPack?.id]);
  const playerNationName = state.scenario?.playerNationName ?? "Player Realm";
  const rivalNationNames = state.scenario?.rivalNationNames ?? [];
  const regionAssignments = state.scenario?.regionAssignments ?? [];
  const playerNationId = state.scenario?.playerNationId ?? "";
  const nations = state.scenario?.nations ?? [];
  const relations = state.scenario?.relations ?? [];
  const nationProfiles = state.scenario?.nationProfiles ?? {};
  const worldNations = state.scenario?.worldState?.nations ?? {};
  const polityPalette = useMemo(() => buildPolityPalette(boundaryData, geoPack.ownerProperty), [boundaryData, geoPack.ownerProperty]);
  const modeMetric = useMemo(() => buildModeMetric(mode, worldNations), [mode, worldNations]);

  const nationNameIndex = useMemo(() => buildNationNameIndex(nations, nationProfiles), [nations, nationProfiles]);

  const overseasTargets = useMemo(
    () => collectOverseasTargets(regionAssignments, playerNationId, playerNationName, boundaryData, geoPack.featureIdProperty),
    [regionAssignments, playerNationId, playerNationName, boundaryData, geoPack.featureIdProperty]
  );
  const [overseasIndex, setOverseasIndex] = useState(0);
  const overseasCount = overseasTargets.length;

  useEffect(() => {
    hoverDataRef.current = {
      geoPack,
      playerNationId,
      nationNameIndex,
      nationProfiles,
      worldNations,
      relations
    };
  }, [geoPack, playerNationId, nationNameIndex, nationProfiles, worldNations, relations]);

  useEffect(() => {
    if (overseasIndex >= overseasTargets.length) setOverseasIndex(0);
  }, [overseasIndex, overseasTargets.length]);

  useEffect(() => {
    let active = true;
    loadGeoJson(LAND_LOCAL_PATH, LAND_REMOTE_URL).then((data) => {
      if (active) setLandData(data);
    });
    loadGeoJson(COASTLINE_LOCAL_PATH, COASTLINE_REMOTE_URL).then((data) => {
      if (active) setCoastlineData(data);
    });
    loadGeoJson(COUNTRIES_LOCAL_PATH, COUNTRIES_REMOTE_URL).then((data) => {
      if (active) setCountriesData(data);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadGeoJson(geoPack.boundariesLocalPath, geoPack.boundariesRemoteUrl).then((data) => {
      if (active) setBoundaryData(data);
    });
    return () => {
      active = false;
    };
  }, [geoPack]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildBlankStyle(),
      center: [-2.5, 51.2],
      zoom: 4.5,
      interactive: true,
      attributionControl: false
    });

    mapRef.current = map;

    const canvas = map.getCanvas();
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setMapRecovering(true);
      if (mapRef.current === map) {
        mapRef.current = null;
      }
      try {
        map.remove();
      } catch {
        // ignore remove errors after context loss
      }
      setMapEpoch((prev) => prev + 1);
    };
    const handleContextRestored = () => {
      setMapRecovering(true);
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    map.on("load", () => {
      setMapRecovering(false);
      map.addSource("land", {
        type: "geojson",
        data: landData as any
      });

      map.addSource("coastline", {
        type: "geojson",
        data: coastlineData as any
      });

      map.addSource("regions", {
        type: "geojson",
        data: boundaryData as any
      });

      map.addSource("countries", {
        type: "geojson",
        data: resolveCountriesData(geoPack, boundaryData, countriesData) as any
      });

      map.addLayer({
        id: "land-fill",
        type: "fill",
        source: "land",
        paint: {
          "fill-color": "#2b2a23",
          "fill-opacity": 0.9
        }
      });

      map.addLayer({
        id: "land-outline",
        type: "line",
        source: "land",
        paint: {
          "line-color": "rgba(242,231,210,0.25)",
          "line-width": 0.6
        }
      });

      map.addLayer({
        id: "coastline",
        type: "line",
        source: "coastline",
        paint: {
          "line-color": "rgba(200,163,87,0.6)",
          "line-width": 0.8
        }
      });

      map.addLayer({
        id: "regions-fill",
        type: "fill",
        source: "regions",
        paint: {
          "fill-color": buildRegionFillPaint(
            mode,
            geoPack,
            playerNationName,
            rivalNationNames,
            regionAssignments,
            playerNationId,
            nations,
            nationProfiles,
            relations,
            polityPalette,
            modeMetric
          ),
          "fill-opacity": mode === "Political" ? 0.6 : 0.35
        }
      });

      map.addLayer({
        id: "regions-outline",
        type: "line",
        source: "regions",
        paint: {
          "line-color": "rgba(216,190,128,0.45)",
          "line-opacity": geoPack.usePolityPalette ? 0.12 : 0.22,
          "line-width": 0.7,
          "line-dasharray": [1.2, 1.2]
        }
      });

      map.addLayer({
        id: "countries-outline",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "rgba(242,231,210,0.5)",
          "line-width": 0.8,
          "line-opacity": geoPack.usePolityPalette ? 0.25 : 0.45
        }
      });

      map.addLayer({
        id: "regions-selected",
        type: "line",
        source: "regions",
        paint: {
          "line-color": "#f2e7d2",
          "line-width": 3.2
        },
        filter: ["==", ["get", geoPack.featureIdProperty], state.selectedRegionId ?? ""]
      });

      map.addLayer({
        id: "countries-selected",
        type: "line",
        source: "regions",
        paint: {
          "line-color": "rgba(242,231,210,0.95)",
          "line-width": 5.6,
          "line-opacity": 1,
          "line-blur": 0.6
        },
        filter: ["==", ["get", geoPack.ownerProperty], ""]
      });

      fitToRegions(map, regionBounds);
    });

    map.on("mousemove", "regions-fill", (event) => {
      map.getCanvas().style.cursor = "pointer";
      const feature = event.features?.[0];
      if (!feature) {
        setHoverInfo(null);
        return;
      }
      const data = hoverDataRef.current;
      const props = feature.properties ?? {};
      const name = pickCountryName(props, data.geoPack);
      if (!name) {
        setHoverInfo(null);
        return;
      }
      const explicitNationId = data.geoPack.nationIdProperty ? props[data.geoPack.nationIdProperty] : null;
      const nationId = typeof explicitNationId === "string"
        ? explicitNationId
        : data.nationNameIndex.get(normalizeKey(name));
      const relationDetail = nationId ? gatherRelation(data.playerNationId, nationId, data.relations) : null;
      const relationCategory = nationId
        ? classifyNationRelation(nationId, data.playerNationId, data.relations)
        : "noTreaties";
      const relationLabel = RELATION_LABELS[relationCategory];
      const stats = nationId ? data.worldNations[nationId] : null;
      const profile = nationId ? data.nationProfiles[nationId] : undefined;
      setHoverInfo({
        x: event.point.x,
        y: event.point.y,
        name,
        relationLabel,
        relationValue: relationDetail?.value ?? null,
        treaties: relationDetail?.treaties ?? [],
        atWar: relationDetail?.atWar ?? false,
        summary: profile?.summary,
        trajectory: profile?.trajectory,
        stats: stats
          ? {
            gdp: stats.gdp ?? 0,
            treasury: stats.treasury ?? 0,
            stability: stats.stability ?? 0,
            population: stats.population ?? 0,
            literacy: stats.literacy ?? 0,
            legitimacy: stats.legitimacy ?? 0
          }
          : undefined
      });
    });
    map.on("mouseleave", "regions-fill", () => {
      map.getCanvas().style.cursor = "";
      setHoverInfo(null);
    });
    map.on("click", "regions-fill", (event) => {
      const feature = event.features?.[0];
      const regionId = feature?.properties?.[geoPack.featureIdProperty];
      if (regionId) dispatch({ type: "select_region", payload: regionId });
    });

    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      if (mapRef.current === map) {
        map.remove();
        mapRef.current = null;
      }
    };
  }, [
    dispatch,
    geoPack,
    regionBounds,
    playerNationName,
    rivalNationNames,
    regionAssignments,
    playerNationId,
    nations,
    relations,
    landData,
    coastlineData,
    countriesData,
    boundaryData,
    modeMetric,
    mapEpoch
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("land") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(landData as any);
  }, [landData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("coastline") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(coastlineData as any);
  }, [coastlineData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(resolveCountriesData(geoPack, boundaryData, countriesData) as any);
  }, [geoPack, boundaryData, countriesData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("regions") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(boundaryData as any);
  }, [boundaryData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("regions-fill")) return;
    map.setPaintProperty(
      "regions-fill",
      "fill-color",
      buildRegionFillPaint(
        mode,
        geoPack,
        playerNationName,
        rivalNationNames,
        regionAssignments,
        playerNationId,
        nations,
        nationProfiles,
        relations,
        polityPalette,
        modeMetric
      )
    );
    map.setPaintProperty("regions-fill", "fill-opacity", mode === "Political" ? 0.6 : 0.35);
  }, [mode, geoPack, playerNationName, rivalNationNames, regionAssignments, playerNationId, nations, nationProfiles, relations, polityPalette, modeMetric]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("regions-outline")) {
      map.setPaintProperty("regions-outline", "line-opacity", geoPack.usePolityPalette ? 0.12 : 0.22);
      map.setPaintProperty("regions-outline", "line-width", 0.7);
    }
    if (map.getLayer("countries-outline")) {
      map.setPaintProperty("countries-outline", "line-opacity", geoPack.usePolityPalette ? 0.25 : 0.45);
      map.setPaintProperty("countries-outline", "line-width", 0.8);
    }
  }, [geoPack.usePolityPalette, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("regions-selected")) {
      map.setFilter("regions-selected", ["==", ["get", geoPack.featureIdProperty], state.selectedRegionId ?? ""]);
    }
    if (map.getLayer("countries-selected")) {
      const selected = boundaryData.features.find(
        (feature) => String(feature?.properties?.[geoPack.featureIdProperty]) === String(state.selectedRegionId ?? "")
      );
      const filterKey = geoPack.nationIdProperty ?? geoPack.ownerProperty;
      const filterValue = selected?.properties?.[filterKey];
      if (filterValue) {
        map.setFilter("countries-selected", ["==", ["get", filterKey], filterValue]);
      } else {
        map.setFilter("countries-selected", ["==", ["get", filterKey], ""]);
      }
    }
  }, [state.selectedRegionId, geoPack.featureIdProperty, geoPack.nationIdProperty, geoPack.ownerProperty, boundaryData]);

  function cycleOverseas() {
    if (overseasCount === 0) return;
    const nextIndex = (overseasIndex + 1) % overseasCount;
    setOverseasIndex(nextIndex);
    const target = overseasTargets[nextIndex];
    if (!target) return;
    dispatch({ type: "select_region", payload: target.featureId });
    const map = mapRef.current;
    if (map) fitToFeature(map, boundaryData, geoPack.featureIdProperty, target.featureId);
  }

  return (
    <>
      <div className="header">
        <h2>Map</h2>
        <div className="row">
          {MODES.map((m) => (
            <button key={m} className={`btn ${m === mode ? "active" : ""}`} onClick={() => setMode(m)} aria-pressed={m === mode}>
              {m}
            </button>
          ))}
          <button
            className="btn ghost"
            type="button"
            onClick={cycleOverseas}
            disabled={overseasCount === 0}
            title={overseasCount === 0 ? "No overseas possessions yet." : "Cycle overseas possessions"}
          >
            Overseas ({overseasCount})
          </button>
        </div>
      </div>
      <div className="content map-content">
        <div className="map-shell">
          <div ref={containerRef} className="map-canvas" />
          {mapRecovering && (
            <div className="map-recovering" role="status" aria-live="polite">
              Restoring map...
            </div>
          )}
            <div className="map-overlay">
              <div className="small">Mode: {mode}</div>
              <div className="small">Selected: {state.selectedRegionId ?? "—"}</div>
            {mode === "Political" ? (
              <PoliticalLegend usePolityPalette={geoPack.usePolityPalette} />
            ) : (
              <MetricLegend metric={modeMetric} />
            )}
            </div>
          {hoverInfo && (
            <div
              className="map-tooltip"
              style={computeTooltipStyle(hoverInfo, containerRef.current)}
            >
              <div className="map-tooltip-title">{hoverInfo.name}</div>
              <div className="small">{hoverInfo.relationLabel}{hoverInfo.relationValue !== null ? ` · Relation ${hoverInfo.relationValue}` : ""}</div>
              {hoverInfo.atWar && <div className="small">At war</div>}
              {hoverInfo.treaties.length > 0 && (
                <div className="small">Treaties: {hoverInfo.treaties.join(", ")}</div>
              )}
              {hoverInfo.summary && <div className="map-tooltip-summary">{hoverInfo.summary}</div>}
              {hoverInfo.stats && (
                <div className="map-tooltip-stats">
                  <div className="map-tooltip-row"><span>GDP</span><span>{formatCompact(hoverInfo.stats.gdp)}</span></div>
                  <div className="map-tooltip-row"><span>Treasury</span><span>{formatCompact(hoverInfo.stats.treasury)}</span></div>
                  <div className="map-tooltip-row"><span>Stability</span><span>{Math.round(hoverInfo.stats.stability)}</span></div>
                  <div className="map-tooltip-row"><span>Population</span><span>{formatCompact(hoverInfo.stats.population)}</span></div>
                  <div className="map-tooltip-row"><span>Literacy</span><span>{formatPercent(hoverInfo.stats.literacy)}</span></div>
                  <div className="map-tooltip-row"><span>Legitimacy</span><span>{Math.round(hoverInfo.stats.legitimacy)}</span></div>
                </div>
              )}
              {hoverInfo.trajectory && (
                <div className="map-tooltip-trajectory">
                  {formatTrajectoryLine(hoverInfo.trajectory)}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          {mode === "Political"
            ? "Political map: provinces shaded by relation. Click a region to inspect."
            : `${mode} map: shaded by relative ${modeMetric?.label ?? "metrics"}. Click a region to inspect.`}
        </div>
      </div>
    </>
  );
}

function buildBlankStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0b0d13" }
      }
    ]
  };
}

function buildRegionFillPaint(
  mode: (typeof MODES)[number],
  geoPack: { ownerProperty: string; featureIdProperty: string; nationIdProperty?: string; useRegionAssignments?: boolean; usePolityPalette?: boolean },
  playerNationName: string,
  rivalNationNames: string[],
  regionAssignments: RegionAssignment[],
  playerNationId: string,
  nations: Array<{ nationId: string; name: string }>,
  nationProfiles: Record<string, { mapAliases: string[] }>,
  relations: Array<{ from_nation_id: string; to_nation_id: string; treaties: string[]; at_war: boolean; value: number }>,
  polityPalette: Array<{ name: string; hue: number }>,
  modeMetric: ModeMetric | null
): ExpressionSpecification {
  if (mode !== "Political" && modeMetric) {
    const metricMatch = geoPack.nationIdProperty
      ? buildMetricMatchById(modeMetric, geoPack.nationIdProperty)
      : buildNationMetricMatch(nations, nationProfiles, modeMetric, geoPack.ownerProperty);
    if (metricMatch) return metricMatch;
  }

  const useAssignments = geoPack.useRegionAssignments
    ?? (geoPack.featureIdProperty !== "ADMIN" || regionAssignments.every((entry) => !resolveAssignmentKey(entry).includes("-")));
  if (useAssignments) {
    const regionMatch = buildRegionAssignmentMatch(regionAssignments, playerNationId, geoPack.featureIdProperty, mode);
    if (regionMatch) return regionMatch;
  }

  if (geoPack.usePolityPalette) {
    const polityMatch = buildPolityPaletteMatch(geoPack.ownerProperty, polityPalette, mode);
    if (polityMatch) return polityMatch;
  }

  const relationMatch = geoPack.nationIdProperty
    ? buildNationRelationMatchById(nations, relations, playerNationId, geoPack.nationIdProperty, mode)
    : buildNationRelationMatch(nations, nationProfiles, relations, playerNationId, geoPack.ownerProperty, mode);
  if (relationMatch) return relationMatch;

  const rivalMatches = rivalNationNames.flatMap((name) => [name, "#5d6b8a"]);
  return [
    "match",
    ["get", geoPack.ownerProperty],
    playerNationName,
    mode === "Political" ? "#c8a357" : "#78643a",
    ...rivalMatches,
    mode === "Political" ? "#2a2e3d" : "#262a35"
  ];
}

function buildModeMetric(mode: (typeof MODES)[number], worldNations: Record<string, any>): ModeMetric | null {
  if (mode === "Political") return null;
  const entries = Object.entries(worldNations ?? {});
  if (entries.length === 0) return null;

  const values: Record<string, number> = {};
  let label: string = mode;
  let palette: [string, string, string] = ["#2a2e3d", "#6b5d3a", "#c8a357"];
  let format = formatCompact;
  let transform: ((value: number) => number) | undefined;

  for (const [nationId, nation] of entries) {
    const stats = nation as Record<string, number>;
    let value: number | undefined;
    if (mode === "Economic") {
      label = "GDP";
      palette = ["#2a2e3d", "#6b5d3a", "#c8a357"];
      transform = (v) => Math.log10(Math.max(1, v));
      value = stats.gdp;
    } else if (mode === "Military") {
      label = "Force size";
      palette = ["#2a2e3d", "#725445", "#e07a5f"];
      transform = (v) => Math.log10(Math.max(1, v));
      value = stats.force_size ?? stats.manpower_pool;
    } else if (mode === "Unrest") {
      label = "Unrest";
      palette = ["#2d3a32", "#6f8c7f", "#e07a5f"];
      format = (val: number) => `${Math.round(val)}`;
      const stability = stats.stability ?? 0;
      value = Math.max(0, 100 - stability);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      values[nationId] = value;
    }
  }

  const valueList = Object.values(values);
  if (valueList.length === 0) return null;
  const min = Math.min(...valueList);
  const max = Math.max(...valueList);
  const transformFn = transform ?? ((val: number) => val);
  const pairs = valueList.map((raw) => ({ raw, transformed: transformFn(raw) }));
  pairs.sort((a, b) => a.transformed - b.transformed);
  const lowerIndex = Math.floor((pairs.length - 1) * 0.1);
  const upperIndex = Math.floor((pairs.length - 1) * 0.9);
  const lower = pairs[lowerIndex] ?? pairs[0];
  const upper = pairs[upperIndex] ?? pairs[pairs.length - 1];
  const colorMin = lower.transformed;
  const colorMax = upper.transformed;
  const legendMin = lower.raw;
  const legendMax = upper.raw;

  return { label, min, max, legendMin, legendMax, colorMin, colorMax, values, palette, format, transform: transformFn };
}

function buildNationMetricMatch(
  nations: Array<{ nationId: string; name: string }>,
  nationProfiles: Record<string, { mapAliases: string[] }>,
  metric: ModeMetric,
  ownerProperty: string
): ExpressionSpecification | null {
  const entries: Array<string | number> = [];
  const seen = new Set<string>();
  for (const nation of nations) {
    const value = metric.values[nation.nationId];
    if (value === undefined) continue;
    const color = colorForMetric(value, metric);
    const aliases = new Set<string>([nation.name, ...(nationProfiles[nation.nationId]?.mapAliases ?? [])]);
    for (const alias of aliases) {
      const key = normalizeKey(alias);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push(key, color);
    }
  }
  if (entries.length === 0) return null;
  return ["match", ["downcase", ["get", ownerProperty]], ...entries, "#262a35"] as unknown as ExpressionSpecification;
}

function buildNationMetricMatchById(
  nations: Array<{ nationId: string; name: string }>,
  metric: ModeMetric,
  nationIdProperty: string
): ExpressionSpecification | null {
  const entries: Array<string | number> = [];
  const seen = new Set<string>();
  for (const nation of nations) {
    const value = metric.values[nation.nationId];
    if (value === undefined) continue;
    if (seen.has(nation.nationId)) continue;
    seen.add(nation.nationId);
    const color = colorForMetric(value, metric);
    entries.push(nation.nationId, color);
  }
  if (entries.length === 0) return null;
  return ["match", ["get", nationIdProperty], ...entries, "#262a35"] as unknown as ExpressionSpecification;
}

function buildMetricMatchById(metric: ModeMetric, nationIdProperty: string): ExpressionSpecification | null {
  const entries: Array<string | number> = [];
  for (const [nationId, value] of Object.entries(metric.values)) {
    const color = colorForMetric(value, metric);
    entries.push(nationId, color);
  }
  if (entries.length === 0) return null;
  return ["match", ["get", nationIdProperty], ...entries, "#262a35"] as unknown as ExpressionSpecification;
}

function colorForMetric(value: number, metric: ModeMetric): string {
  if (metric.colorMax <= metric.colorMin) return metric.palette[1];
  const transformed = metric.transform ? metric.transform(value) : value;
  const ratio = Math.max(0, Math.min(1, (transformed - metric.colorMin) / (metric.colorMax - metric.colorMin)));
  if (ratio <= 0.5) {
    return mixColor(metric.palette[0], metric.palette[1], ratio * 2);
  }
  return mixColor(metric.palette[1], metric.palette[2], (ratio - 0.5) * 2);
}

function mixColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const clean = hex.replace("#", "");
    const int = parseInt(clean, 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255
    };
  };
  const ca = parse(a);
  const cb = parse(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const b2 = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r}, ${g}, ${b2})`;
}

function buildPolityPalette(boundaryData: GeoJsonFeatureCollection, ownerProperty: string): Array<{ name: string; hue: number }> {
  const seen = new Set<string>();
  const entries: Array<{ name: string; hue: number }> = [];
  for (const feature of boundaryData.features ?? []) {
    const name = feature?.properties?.[ownerProperty];
    if (typeof name !== "string" || !name.trim()) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, hue: hashHue(name) });
  }
  return entries;
}

function buildPolityPaletteMatch(ownerProperty: string, palette: Array<{ name: string; hue: number }>, mode: (typeof MODES)[number]): ExpressionSpecification | null {
  if (palette.length === 0) return null;
  const entries: Array<string | number> = [];
  for (const entry of palette) {
    entries.push(entry.name, colorFromHue(entry.hue, mode));
  }
  return ["match", ["get", ownerProperty], ...entries, colorFromHue(0, mode)] as unknown as ExpressionSpecification;
}

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return hash;
}

function colorFromHue(hue: number, mode: (typeof MODES)[number]): string {
  if (mode === "Political") return `hsl(${hue}, 42%, 36%)`;
  return `hsl(${hue}, 32%, 28%)`;
}

function buildRegionAssignmentMatch(
  assignments: RegionAssignment[],
  playerNationId: string,
  featureIdProperty: string,
  mode: (typeof MODES)[number]
): ExpressionSpecification | null {
  if (!assignments.length) return null;
  const colors = mode === "Political"
    ? { player: "#c8a357", rival: "#5d6b8a", unknown: "#2a2e3d" }
    : { player: "#78643a", rival: "#3a4253", unknown: "#262a35" };
  const entries: Array<string | number> = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const color = assignment.nationId === playerNationId ? colors.player : colors.rival;
    const keys = buildAssignmentKeys(resolveAssignmentKey(assignment));
    for (const key of keys) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push(key, color);
    }
  }
  if (entries.length === 0) return null;
  return ["match", ["downcase", ["get", featureIdProperty]], ...entries, colors.unknown] as unknown as ExpressionSpecification;
}

function buildNationRelationMatch(
  nations: Array<{ nationId: string; name: string }>,
  nationProfiles: Record<string, { mapAliases: string[] }>,
  relations: Array<{ from_nation_id: string; to_nation_id: string; treaties: string[]; at_war: boolean; value: number }>,
  playerNationId: string,
  ownerProperty: string,
  mode: (typeof MODES)[number]
): ExpressionSpecification | null {
  if (!nations.length) return null;
  const colors = mode === "Political"
    ? {
      crown: "#c8a357",
      subject: "#8fb7a7",
      allied: "#7aa6d6",
      treaties: "#a3b86f",
      noTreaties: "#4b5567",
      enemy: "#e07a5f"
    }
    : {
      crown: "#78643a",
      subject: "#4c7a67",
      allied: "#4f6d92",
      treaties: "#6d7f4c",
      noTreaties: "#3a4253",
      enemy: "#b65a44"
    };

  const entries: Array<string | number> = [];
  const seen = new Set<string>();
  for (const nation of nations) {
    const category = classifyNationRelation(nation.nationId, playerNationId, relations);
    const color = colors[category];
    const aliases = new Set<string>([nation.name, ...(nationProfiles[nation.nationId]?.mapAliases ?? [])]);
    for (const alias of aliases) {
      const key = normalizeKey(alias);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push(key, color);
    }
  }
  if (entries.length === 0) return null;
  return ["match", ["downcase", ["get", ownerProperty]], ...entries, colors.noTreaties] as unknown as ExpressionSpecification;
}

function buildNationRelationMatchById(
  nations: Array<{ nationId: string; name: string }>,
  relations: Array<{ from_nation_id: string; to_nation_id: string; treaties: string[]; at_war: boolean; value: number }>,
  playerNationId: string,
  nationIdProperty: string,
  mode: (typeof MODES)[number]
): ExpressionSpecification | null {
  if (!nations.length) return null;
  const colors = mode === "Political"
    ? {
      crown: "#c8a357",
      subject: "#8fb7a7",
      allied: "#7aa6d6",
      treaties: "#a3b86f",
      noTreaties: "#4b5567",
      enemy: "#e07a5f"
    }
    : {
      crown: "#78643a",
      subject: "#4c7a67",
      allied: "#4f6d92",
      treaties: "#6d7f4c",
      noTreaties: "#3a4253",
      enemy: "#b65a44"
    };

  const entries: Array<string | number> = [];
  const seen = new Set<string>();
  for (const nation of nations) {
    if (seen.has(nation.nationId)) continue;
    seen.add(nation.nationId);
    const category = classifyNationRelation(nation.nationId, playerNationId, relations);
    const color = colors[category];
    entries.push(nation.nationId, color);
  }
  if (entries.length === 0) return null;
  return ["match", ["get", nationIdProperty], ...entries, colors.noTreaties] as unknown as ExpressionSpecification;
}

function classifyNationRelation(
  nationId: string,
  playerNationId: string,
  relations: Array<{ from_nation_id: string; to_nation_id: string; treaties: string[]; at_war: boolean; value: number }>
): "crown" | "subject" | "allied" | "treaties" | "noTreaties" | "enemy" {
  if (nationId === playerNationId) return "crown";
  const relation = gatherRelation(playerNationId, nationId, relations);
  if (!relation) return "noTreaties";
  if (relation.atWar) return "enemy";
  if (relation.hasSubject) return "subject";
  if (relation.hasAlliance) return "allied";
  if (relation.hasTreaty) return "treaties";
  return "noTreaties";
}

function gatherRelation(
  playerNationId: string,
  otherNationId: string,
  relations: Array<{ from_nation_id: string; to_nation_id: string; treaties: string[]; at_war: boolean; value: number }>
): { atWar: boolean; hasTreaty: boolean; hasAlliance: boolean; hasSubject: boolean; treaties: string[]; value: number } | null {
  const relevant = relations.filter((rel) =>
    (rel.from_nation_id === playerNationId && rel.to_nation_id === otherNationId)
      || (rel.from_nation_id === otherNationId && rel.to_nation_id === playerNationId)
  );
  if (relevant.length === 0) return null;
  const treaties = new Set<string>();
  let atWar = false;
  let valueSum = 0;
  for (const rel of relevant) {
    valueSum += rel.value ?? 0;
    if (rel.at_war) atWar = true;
    for (const treaty of rel.treaties ?? []) treaties.add(String(treaty));
  }
  const treatyList = Array.from(treaties);
  const treatyLower = treatyList.map((t) => t.toLowerCase());
  const hasAlliance = treatyLower.some((t) => t.includes("alliance") || t.includes("defensive") || t.includes("guarantee"));
  const hasSubject = treatyLower.some((t) =>
    t.includes("vassal") || t.includes("tributary") || t.includes("subject") || t.includes("protectorate") || t.includes("union")
  );
  const hasTreaty = treatyLower.length > 0;
  const value = Math.round(valueSum / relevant.length);
  return { atWar, hasTreaty, hasAlliance, hasSubject, treaties: treatyList, value };
}

function resolveAssignmentKey(assignment: RegionAssignment): string {
  const key = assignment.geoRegionKey?.trim();
  return key || assignment.geoRegionId;
}

function buildAssignmentKeys(geoRegionId: string): string[] {
  const raw = geoRegionId.replace(/_/g, " ").trim();
  const lowered = raw.toLowerCase();
  const parts = raw.split("-");
  const trimmed = parts.length > 1 ? parts.slice(1).join("-") : raw;
  const trimmedLower = trimmed.replace(/_/g, " ").trim().toLowerCase();
  return lowered === trimmedLower ? [lowered] : [lowered, trimmedLower];
}

function collectOverseasTargets(
  assignments: RegionAssignment[],
  playerNationId: string,
  playerNationName: string,
  boundaryData: GeoJsonFeatureCollection,
  featureIdProperty: string
): Array<{ featureId: string }> {
  if (!assignments.length || !boundaryData.features?.length) return [];
  const homelandKey = normalizeKey(playerNationName).split(" ")[0] ?? "";
  const featureIndex = new Map<string, string>();
  for (const feature of boundaryData.features ?? []) {
    const raw = feature?.properties?.[featureIdProperty];
    if (typeof raw !== "string" || !raw.trim()) continue;
    featureIndex.set(normalizeKey(raw), raw);
  }
  const targets: Array<{ featureId: string }> = [];
  const seen = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.nationId !== playerNationId) continue;
    const regionKey = normalizeKey(resolveAssignmentKey(assignment));
    if (homelandKey && regionKey.startsWith(homelandKey)) continue;
    const keys = buildAssignmentKeys(resolveAssignmentKey(assignment));
    for (const key of keys) {
      const match = featureIndex.get(key);
      if (!match || seen.has(match)) continue;
      seen.add(match);
      targets.push({ featureId: match });
    }
  }
  return targets;
}

function PoliticalLegend({ usePolityPalette }: { usePolityPalette?: boolean }) {
  if (usePolityPalette) {
    return (
      <div className="legend">
        <div className="legend-row">
          <span className="legend-swatch legend-neutral" />
          <span className="small">Polity palette (unique colors)</span>
        </div>
        <div className="legend-row">
          <span className="small">Hover a polity for relation details.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="legend">
      <div className="legend-row">
        <span className="legend-swatch legend-crown" />
        <span className="small">Crown lands</span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch legend-subject" />
        <span className="small">Subjects</span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch legend-allied" />
        <span className="small">Allied</span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch legend-treaties" />
        <span className="small">Treaties exist</span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch legend-neutral" />
        <span className="small">No treaties</span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch legend-enemy" />
        <span className="small">Enemy</span>
      </div>
    </div>
  );
}

function MetricLegend({ metric }: { metric: ModeMetric | null }) {
  if (!metric) {
    return (
      <div className="legend">
        <div className="legend-row">
          <span className="small">No metric data available.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="legend">
      <div className="legend-row">
        <span
          className="legend-gradient"
          style={{
            "--legend-low": metric.palette[0],
            "--legend-mid": metric.palette[1],
            "--legend-high": metric.palette[2]
          } as CSSProperties}
        />
        <span className="small">{metric.label}</span>
      </div>
      <div className="legend-row">
        <span className="small">
          Scale {metric.format(metric.legendMin)} · {metric.format(metric.legendMax)} (P10–P90)
        </span>
      </div>
    </div>
  );
}

function buildNationNameIndex(
  nations: Array<{ nationId: string; name: string }>,
  profiles: Record<string, { mapAliases: string[] }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const nation of nations) {
    const key = normalizeKey(nation.name);
    if (key) map.set(key, nation.nationId);
    const aliases = profiles[nation.nationId]?.mapAliases ?? [];
    for (const alias of aliases) {
      const aliasKey = normalizeKey(alias);
      if (aliasKey) map.set(aliasKey, nation.nationId);
    }
  }
  return map;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function pickCountryName(properties: Record<string, any>, geoPack: { ownerProperty: string; featureIdProperty: string }): string | null {
  const candidates = [
    properties[geoPack.ownerProperty],
    properties[geoPack.featureIdProperty],
    properties.ADMIN,
    properties.NAME,
    properties.NAME_LONG,
    properties.name
  ];
  for (const entry of candidates) {
    if (typeof entry === "string" && entry.trim()) return entry.trim();
  }
  return null;
}

function computeTooltipStyle(info: HoverInfo, container: HTMLDivElement | null): CSSProperties {
  const maxWidth = 260;
  const maxHeight = 260;
  const offset = 12;
  let left = info.x + offset;
  let top = info.y + offset;
  if (container) {
    const { width, height } = container.getBoundingClientRect();
    if (left + maxWidth > width) left = Math.max(8, width - maxWidth - 8);
    if (top + maxHeight > height) top = Math.max(8, height - maxHeight - 8);
  }
  return { left, top };
}

function resolveCountriesData(
  geoPack: { useBoundariesForCountries?: boolean },
  boundaryData: GeoJsonFeatureCollection,
  countriesData: GeoJsonFeatureCollection
): GeoJsonFeatureCollection {
  return geoPack.useBoundariesForCountries ? boundaryData : countriesData;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${Math.round(value)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTrajectoryLine(trajectory: Record<string, number | undefined>): string {
  const parts: string[] = [];
  if (trajectory.gdp_growth_decade !== undefined) parts.push(`GDP ${formatSignedPercent(trajectory.gdp_growth_decade)}/dec`);
  if (trajectory.population_growth_decade !== undefined) parts.push(`Pop ${formatSignedPercent(trajectory.population_growth_decade)}/dec`);
  if (trajectory.stability_drift_decade !== undefined) parts.push(`Stability ${formatSignedNumber(trajectory.stability_drift_decade)}/dec`);
  if (trajectory.literacy_growth_decade !== undefined) parts.push(`Literacy ${formatSignedPercent(trajectory.literacy_growth_decade)}/dec`);
  if (parts.length === 0) return "";
  return `Trajectory: ${parts.join(" · ")}`;
}

function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatSignedNumber(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function annotateRegions(
  base: RegionFeatureCollection,
  scenario: { playerNationId: string; regionAssignments: RegionAssignment[] } | null
): RegionFeatureCollection {
  const assignments = new Map(scenario?.regionAssignments.map((entry) => [resolveAssignmentKey(entry), entry.nationId]));
  const playerNationId = scenario?.playerNationId;

  return {
    type: "FeatureCollection",
    features: base.features.map((feature) => {
      const regionId = feature.properties.geo_region_id;
      const nationId = assignments.get(regionId);
      const owner = nationId ? (nationId === playerNationId ? "player" : "rival") : "unknown";
      return {
        ...feature,
        properties: {
          ...feature.properties,
          nation_id: nationId,
          owner
        }
      };
    })
  };
}

function fitToRegions(map: maplibregl.Map, data: RegionFeatureCollection) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const feature of data.features) {
    const coords = feature.geometry.coordinates;
    const rings = feature.geometry.type === "Polygon" ? coords : coords.flat(1);
    for (const ring of rings) {
      for (const point of ring) {
        const [lng, lat] = point;
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }

  if (Number.isFinite(minLng) && Number.isFinite(minLat)) {
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat]
      ],
      { padding: 24, duration: 0 }
    );
  }
}

function fitToFeature(
  map: maplibregl.Map,
  data: GeoJsonFeatureCollection,
  featureIdProperty: string,
  featureId: string
) {
  const feature = data.features.find((entry) => String(entry?.properties?.[featureIdProperty]) === featureId);
  if (!feature) return;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const coords = feature.geometry.coordinates;
  const rings = feature.geometry.type === "Polygon" ? coords : coords.flat(1);
  for (const ring of rings) {
    for (const point of ring) {
      const [lng, lat] = point;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }
  }

  if (Number.isFinite(minLng) && Number.isFinite(minLat)) {
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat]
      ],
      { padding: 36, duration: 400 }
    );
  }
}

async function loadGeoJson(localPath: string, remoteUrl: string): Promise<GeoJsonFeatureCollection> {
  const local = await fetchGeoJson(localPath);
  if (local) return local;
  const remote = await fetchGeoJson(remoteUrl);
  return remote ?? EMPTY_GEOJSON;
}

async function fetchGeoJson(url: string): Promise<GeoJsonFeatureCollection | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as GeoJsonFeatureCollection;
  } catch {
    return null;
  }
}
