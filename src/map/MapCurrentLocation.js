import * as maplibregl from 'maplibre-gl';
import { useEffect } from 'react';
import { map } from './core/MapView';
import { toMapCoordinates } from './core/mapUtil';
import { useTheme } from '@mui/material';

const MapCurrentLocation = () => {
  const theme = useTheme();

  useEffect(() => {
    const control = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        timeout: 5000,
      },
      trackUserLocation: false,
    });
    // GeolocateControl places the marker and camera using raw browser coordinates,
    // so convert them to the map coordinate system first (GCJ-02 on Chinese basemaps)
    const handleSuccess = control._onSuccess;
    control._onSuccess = (position) => {
      const [longitude, latitude] = toMapCoordinates(
        position.coords.longitude,
        position.coords.latitude,
      );
      handleSuccess({
        ...position,
        coords: {
          latitude,
          longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        },
      });
    };
    map.addControl(control, theme.direction === 'rtl' ? 'top-left' : 'top-right');
    return () => map.removeControl(control);
  }, [theme.direction]);

  return null;
};

export default MapCurrentLocation;
