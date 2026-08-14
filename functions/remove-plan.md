cd functions

# Podgląd

npm run plan:remove -- --dry-run UID_1 UID_2

# Usunięcie

npm run plan:remove -- UID_1 UID_2

# Można też użyć e-maili

npm run plan:remove -- user@example.com

Opcjonalnie wymuszenie ponownego logowania:
npm run plan:remove -- --revoke-sessions UID_1
