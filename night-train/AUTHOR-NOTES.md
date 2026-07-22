# Author notes — spoilers

## The truth

Clara Voss is carrying original documents about the Rabenbrücke disaster. They prove that railway inspector Viktor Noll ordered an unsafe load test to stop, but the railway board forced it to continue. Professor Adler later removed Noll's objection from the official inquiry report.

Voss expects someone to steal the documents. Before departure she swaps her real case with one of stage magician Mara Vale's identical silver prop cases. The real case is hidden in the false bottom of Mara's stage trunk.

Noll boards using a stolen railway uniform. He drugs Voss, steals the decoy and later searches the luggage car for the real case. His motive is mixed: he commits crimes, but the documents really can clear his name.

## Main cast

- **Clara Voss** — investigative journalist; wants to publish but protect confidential sources.
- **Viktor Noll** — former railway inspector and scapegoat; steals the case to recover proof.
- **Professor Elias Adler** — chaired the old inquiry and signed the compromised report.
- **Mara Vale** — stage magician and Voss's friend; arranged the suitcase swap.
- **Dr. Samir Levin** — recognizes that Voss was drugged.
- **Helena Falk** — train conductor; initially hides the missing uniform to protect the railway.

## Story phases

1. **Initial investigation** — characters occupy their original cars.
2. **Midnight stop** — locations change; the stolen uniform and service area become important.
3. **Blackout** — the thief moves forward; the decoy and real case can be found.
4. **Final gathering** — the player decides what to do with the evidence.

The phase changes also demonstrate moving characters through variables such as:

```js
adler_location = 'dining';
mara_location = 'observation';
```

Car pages use conditions to show only characters currently present.

## State categories

### World state

- `phase`
- `minutes_to_arrival`
- character location variables
- `noll_detained`

### Knowledge and evidence

- `evidence`
- `knows_*` variables
- `has_noll_photo`
- `has_staff_list`
- `has_red_fiber`

### Inventory

- `has_master_key`
- `has_decoy_suitcase`
- `has_real_suitcase`

### Relationships

- `adler_trust`
- `mara_trust`
- `doctor_trust`
- `conductor_trust`
- `voss_trust`

## Suggested extensions

- Add a first-class passenger whose alibi changes after the blackout.
- Add a mail car between luggage and service cars.
- Let the player miss the midnight event by spending too much time.
- Add a second route to the real suitcase.
- Add a character who sincerely believes the wrong explanation.
- Add more endings based on which confidential names are protected.
- Let Noll move between cars before the confrontation.
- Add images for the title, tickets, red gloves and train map.
