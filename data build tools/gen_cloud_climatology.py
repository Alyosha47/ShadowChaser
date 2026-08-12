#!/usr/bin/env python3
"""
gen_cloud_climatology.py  —  phase 1 of the cloud-cover overlay (#F2).

Downloads ERA5 total cloud cover as a 1991-2020 climatology for ONE month,
then collapses the 24 UTC hours into 8 LOCAL SOLAR TIME slices
(00, 03, 06, 09, 12, 15, 18, 21 LST) and writes a small .npz.

Goes in:  data build tools/
Run from: repo root
Output:   data/cloud/cloud_MM.npz   (uint8, ~8 MB)

    python3 "data build tools/gen_cloud_climatology.py" 8

--------------------------------------------------------------------------
SETUP (once)
  1. Free account at https://cds.climate.copernicus.eu
  2. Open the dataset page "ERA5 monthly averaged data on single levels
     from 1940 to present" and ACCEPT THE LICENCE. Downloads 403 without it.
  3. Copy your token from the CDS "API" page into ~/.cdsapirc :
         url: https://cds.climate.copernicus.eu/api
         key: YOUR_PERSONAL_ACCESS_TOKEN
  4. pip install cdsapi xarray netCDF4 numpy

If CDS rejects the 'grid' key, delete that line and set NATIVE_ONLY = True;
the script will downsample locally instead (3 GB of download rather than 750 MB).
--------------------------------------------------------------------------
"""

import sys, pathlib, numpy as np, xarray as xr, cdsapi

YEARS       = [str(y) for y in range(1991, 2021)]   # WMO standard normal
DEG         = 0.5                                    # output grid, degrees
LST_HOURS   = [0, 3, 6, 9, 12, 15, 18, 21]
NATIVE_ONLY = False
OUTDIR      = pathlib.Path("data/cloud")
CACHE       = pathlib.Path("data build tools/_cloud_cache")


def fetch_hour(month, utc_hour):
    """30-year mean of total cloud cover for one month at one UTC hour."""
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / f"tcc_{month:02d}_{utc_hour:02d}.nc"

    if not target.exists():
        request = {
            "product_type": ["monthly_averaged_reanalysis_by_hour_of_day"],
            "variable":     ["total_cloud_cover"],
            "year":         YEARS,
            "month":        [f"{month:02d}"],
            "time":         [f"{utc_hour:02d}:00"],
            "data_format":  "netcdf",
        }
        if not NATIVE_ONLY:
            request["grid"] = [DEG, DEG]
        cdsapi.Client().retrieve(
            "reanalysis-era5-single-levels-monthly-means", request, str(target))

    ds = xr.open_dataset(target)
    tcc = ds["tcc"]
    time_dim = next(d for d in tcc.dims if d in ("valid_time", "time"))
    field = tcc.mean(dim=time_dim).values.astype(np.float32)   # (lat, lon)
    lons = ds[next(c for c in ds.coords if c in ("longitude", "lon"))].values
    ds.close()
    return field, lons


def to_minus180(field, lons):
    """ERA5 ships 0..360; roll so column 0 is -180. Idempotent."""
    if lons.max() <= 180.0:
        return field, lons
    shift = int(np.sum(lons >= 180.0))
    return np.roll(field, shift, axis=1), np.roll(lons - 360.0 * (lons >= 180), shift)


def build_lst_slices(utc):
    """utc[h] is the field at UTC hour h. Return one field per LST hour.

    For a column at longitude L, local solar time = UTC + L/15, so the UTC
    hour feeding LST slice `hl` is  hl - L/15.  Blend the two bracketing
    integer UTC hours, so each column is exact to ERA5's own resolution.
    """
    nlat, nlon = utc[0].shape
    lon = -180.0 + (np.arange(nlon) + 0.5) * (360.0 / nlon)
    stack = np.stack(utc)                                   # (24, lat, lon)
    out = []
    for hl in LST_HOURS:
        src = (hl - lon / 15.0) % 24.0
        lo, w = np.floor(src).astype(int) % 24, src - np.floor(src)
        hi = (lo + 1) % 24
        cols = np.arange(nlon)
        field = (stack[lo, :, cols].T * (1 - w) + stack[hi, :, cols].T * w)
        out.append(field.astype(np.float32))
    return np.stack(out)                                    # (8, lat, lon)


def main(month):
    utc, lons = [], None
    for h in range(24):
        print(f"  UTC {h:02d}:00 ...", flush=True)
        field, lons = fetch_hour(month, h)
        field, lons = to_minus180(field, lons)
        utc.append(field)

    slices = build_lst_slices(utc)
    if not (0.0 <= np.nanmin(slices) and np.nanmax(slices) <= 1.0):
        sys.exit(f"tcc outside 0..1 — got {np.nanmin(slices)}..{np.nanmax(slices)}")

    # 0..250 = cloud fraction; 255 = no data. Never let the two be confused.
    packed = np.where(np.isnan(slices), 255,
                      np.round(slices * 250.0)).astype(np.uint8)

    OUTDIR.mkdir(parents=True, exist_ok=True)
    out = OUTDIR / f"cloud_{month:02d}.npz"
    np.savez_compressed(out, data=packed, lst_hours=np.array(LST_HOURS),
                        month=month, deg=DEG, years=f"{YEARS[0]}-{YEARS[-1]}")
    print(f"\n{out}  {out.stat().st_size/1e6:.1f} MB  shape {packed.shape}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8)
