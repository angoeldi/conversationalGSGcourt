# Natural Earth admin-1 (ne_admin1_v1)

## Common properties
- `name`: province/state name (use for `featureIdProperty`).
- `admin`: sovereign/admin country name (use for `ownerProperty`).
- `iso_a2`: ISO country code (useful for alternative matching).

## Mapping guidance
- For political mode, prefer mapping via `region_assignments` using `name` (province-level control).
- If you only need country-level shading, use `admin` as the owner property.

## Notes
- Names are English and modern. Historical scenarios may need a mapping table or normalization.
- Some region names contain spaces or diacritics; normalize by lowercasing and replacing underscores with spaces when matching.
