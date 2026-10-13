/**
 * A fixed blind-signing keypair for the harness.
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *
 *   openssl genrsa -out /tmp/av-harness-blind.pem 3072
 *   node harness/scripts/makeBlindKeyPair.ts /tmp/av-harness-blind.pem
 *
 * WebCrypto RSA key generation is the only entropy-consuming step on the harness
 * path, so committing a fixed keypair is what makes a whole round byte-for-byte
 * reproducible. The key is a PUBLIC test fixture with no value; it must never be
 * used outside the harness.
 */
import type { QuestionnaireBlindPrivateKey } from "../src/questionnaireBlindSignature";

export const HARNESS_BLIND_KEY_SCHEME = "rsabssa-sha384-pss-deterministic-v1";

export const HARNESS_BLIND_KEY_ID = "b02ef6a267124fc5ec7edb9c";

export const HARNESS_BLIND_KEY_PAIR: QuestionnaireBlindPrivateKey = {
  scheme: HARNESS_BLIND_KEY_SCHEME,
  keyId: HARNESS_BLIND_KEY_ID,
  jwk: {
  "kty": "RSA",
  "n": "zL2ng8yYlN1J4n_1Qv5qtb8uo5rOq8ZQSQcvzFjp-zRO28ipCqMdlifJdTCaZLNQN9X7DN39Pz13Cvw_OJyWj7xrtkNmzuGryORpQP_-EUpnwFY09o_Mrpw2hu2FSADstVNOLfeSS4xbQgB5GZXmP4ju5c4yuFkAZ6kAnL5FgFMfbHtclQitRqN7jOpqyD_uP6eDby0WLXGCuPneiklDgFboYA-m2syN648jt9np8NihjDSFf3D0l5coCzT8u3iqRW663OHdW6VcadEH0-V0bHITB-6nKpNgufQ-s2qv8B_DQ_XjWaAspahlnszPZPCTfzvEpdIS5XGfx6LkLz3GFnqpFn3yBFpXJh_cSOROUY9mj7WVN4-BgSXnRNkqjqGEHknOoXI3KA0sjBiGpvbAGPDTizbqDJqAgNreJ9EKtYSOs-3HmY_0U8vo22AxYOa5BBRd6aqtOG4RlUV-_43mPv3vM_2PA_AQnxze6YJbbZE4aYBTSKw5E8zygF-VnIfn",
  "e": "AQAB",
  "alg": "PS384",
  "ext": true
},
  privateJwk: {
  "kty": "RSA",
  "n": "zL2ng8yYlN1J4n_1Qv5qtb8uo5rOq8ZQSQcvzFjp-zRO28ipCqMdlifJdTCaZLNQN9X7DN39Pz13Cvw_OJyWj7xrtkNmzuGryORpQP_-EUpnwFY09o_Mrpw2hu2FSADstVNOLfeSS4xbQgB5GZXmP4ju5c4yuFkAZ6kAnL5FgFMfbHtclQitRqN7jOpqyD_uP6eDby0WLXGCuPneiklDgFboYA-m2syN648jt9np8NihjDSFf3D0l5coCzT8u3iqRW663OHdW6VcadEH0-V0bHITB-6nKpNgufQ-s2qv8B_DQ_XjWaAspahlnszPZPCTfzvEpdIS5XGfx6LkLz3GFnqpFn3yBFpXJh_cSOROUY9mj7WVN4-BgSXnRNkqjqGEHknOoXI3KA0sjBiGpvbAGPDTizbqDJqAgNreJ9EKtYSOs-3HmY_0U8vo22AxYOa5BBRd6aqtOG4RlUV-_43mPv3vM_2PA_AQnxze6YJbbZE4aYBTSKw5E8zygF-VnIfn",
  "e": "AQAB",
  "d": "DZ6sLxiu1HBSwu4vhZu2bjgKmo2TeVqBlWoUpEEMnPkM1JK-VAZ9KF5QiNWJNRu3QWT1r2nGYqzsZ18CYaS2YKzFyY569KuPKZewPMe1bLcIvIMU64tYsAuU662PSTaZMzLDJ6Gpf2cV3F0lsS2x7xYP4QUHhhCS9f0IcmTh62McMF5AeWrmA_tKHm9VrSk7kyEfSDJf9aPwcJexVdJWhYoX0-lr-HAqcg9ymSoLkEmzmB0XqF5TlxCndEoRFJ42hD-ylGPVEA_zErqe0ZxA4ASEp1ss0RELymk4TknV4Nz3otT9M-R8Y8op0MkRqrUu-oGGkD47_9J7_KIxmQcSK1DQ9hI_4kjfXHXzXyA0yht6vdF9JtNGUl1L9GFiS50PB1RLY_oFj9hTVuHYafwalSj1t0ovZ1oAQjRbNr1H2B6UlbHOQzPqa4TalZLaIlxeAf9iF8EDnAISYttLAVXcBC07-DNm-PBjfE8ju8EXX9RDzXLf8pq82jwMoXz6w_55",
  "p": "-lucsmVE1RJ01-0UWNKkDaFTn3MV6N_9QiJ1B00WJRqOKQPtBwyM8fVldeSr-1OLsjRzlzqZ_dN7gC-NTzdv7FeVdMHkLwf9BvH7KveFj2e7bX0PAm7c2rLlvREDRJYX8h6RTCh4BNjZWrY_MbfIUpzzWDMmX9eCH0ozey5YX2IhPXnNNSfP8sMmfnglElNqr9nxeR_wdLJDaD2bFqNpeWVG3xSCKmiRP3f3t4QaZp-hXwZJEND29RoKaKkFEfst",
  "q": "0VrdQWwMnxk6hWarQtXBdYldBS1wohuL-kZ7MUPRVyKx26q7kf45LhkeU0o2pY5KY1yN9ptLX7EFisCzA3PRg0Zj7aW0MfAEReWGyAXNzzvWgqUtgI7LHQwNCfbG1PSe-1V-z0jBg4MOypfki1Ba1u7ib4CQAkECotNjJc4EcVsNFj8h7g5Ii28BIRCK_ih99_7COLtlHR_SWWckcgkKUwTKsk_q6LdyagpAYLSciYnueO22-9Lpq2XfrwS-y2vj",
  "dp": "btYcG0aGIKaZH_cPqPsoMfiYIuE6c-ymHJ9QnDjecvK8uR_J0fMWexAfKQBhu1STZgOeoPcKsbrs1CU5NDbg0As-WYB1WvT4ahi7D5yhfol4CtLw0Czwjcnht8BOaBDi7QfnX4YTDGJMZ8KDW6l3gEuH2CZc-NVaACxDemdcLG4vNR41YTEM-Pa4lgjusJxJgSzFoNApDiDVgtKzVGRoD5xssdpMfiXpF-Yuvwo2_fPx5zXLJyy8CGrM7OTXH8zJ",
  "dq": "etOmj-WGmilBDlcoD3Q9pmnK62i3dkRXIaUMTeEOBuNSGiDXH1ZZ0dPm2NLnsMYEmrsIhzChTikbqUZZQKNIvo4jvp_DUrEQsLlzFBNjpjvjJI8oXQ5p2Ebjt37TNMm4JJkKZy62aiQQH4hyC9I_GW7Z5rU0yD3AACupNdri_GaBDRZJH9O9eCDONsnv4iF7lm4fIQ3Ayw-KZ-19knH_XqmnCmqc1aAbPl95WcNdO8xy3vwIqUIa2fZQ_-v2zH4l",
  "qi": "MW0i1FYpFCWtIQYa7oCyQRZcsDUyS_1MJ1ZZL5sRacjPtNErL3MyDde3BthFXNMr_sCkY3lvbOsitNLHyTx530fSOdTIXJLPpZ1xK-mNOw72aGZ3g4qvdQlvi16eSKtX0-YQ2Ivm7rIz_0CThuT4xC_2CaiIqm7t1uiynvF0WU_eyrMNB8DoPKazy1tfvoYUIVUvylX0LNRhK9g730_X3NdLZS5hLAYLUXWdmtMWWalNlQ7F8CJIfjKS4X2Xn0lU",
  "alg": "PS384",
  "ext": true
},
};
