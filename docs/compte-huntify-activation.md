# Mise en service du compte Huntify (email + code à 6 chiffres)

La refonte ajoute le bouton **Créer mon compte / Connexion** et la section **Historique de mes recherches**. Les recherches invitées restent localement sur l'appareil. **La connexion et la synchronisation entre appareils ne seront opérationnelles qu'après ces étapes.**

1. Dans Supabase, créez/ouvrez le projet choisi. Exécutez `supabase/migrations/20261023_huntify_accounts.sql` via SQL Editor. Ne désactivez pas la RLS.
2. Dans Vercel > Huntify > Settings > Environment Variables, définissez **pour Preview et Production** :
   - `SUPABASE_URL` : `https://<project-ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` : clé publique `sb_publishable_...` (ou `SUPABASE_ANON_KEY` publique héritée).
   Ne mettez **jamais** une service-role key ou une clé secrète côté navigateur.
3. Supabase > Authentication > Providers : activer Email. Pour un **code OTP** et non un simple lien magique, le modèle de message Email > Magic Link doit contenir `{{ .Token }}` (6 chiffres). Vérifiez l'URL du site, les domaines de redirection et les limitations de débit.
4. Pour les utilisateurs réels, configurez un SMTP fiable (envoi d'emails) et testez réception, expiration du code, reconnexion, déconnexion et récupération après rechargement de page. Le service mail fourni par défaut convient mal à un site public à forte audience.
5. Redéployez la branche en Preview puis testez deux comptes distincts : favoris et historiques d'un compte ne doivent jamais être visibles par l'autre. Contrôlez les policies RLS avec les rôles `anon` et `authenticated`.

Fonctionnement : création du compte après vérification du code, conservation des recherches/favoris sur cet appareil sans compte, puis synchronisation dans les tables privées à la connexion. L'interface n'active **pas encore les alertes email** ni leur vérification automatique ; les seuils restent des brouillons locaux inactifs.

L'intégration `@supabase/supabase-js` est chargée dans le navigateur via CDN ESM ; pour une application plus mature, intégrer le SDK au build, figer sa version et compléter le CSP.

Les prix, les recherches marchandes et le comparateur existants ne sont pas modifiés par cette branche.
