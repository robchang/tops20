/* DVNI20_STUB.C - Stub NIA20 Network Interface for WebAssembly
** 
** This is a minimal stub implementation that satisfies TOPS-20's 
** expectations without actually doing networking, to avoid LAPRBF errors.
*/

#include "klh10.h"

#if !KLH10_DEV_NI20 && CENV_SYS_DECOSF
static int decosfcclossage;
#endif

#if KLH10_DEV_NI20

#include <stddef.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#include "kn10def.h"
#include "kn10dev.h"
#include "dvni20.h"
#include "prmstr.h"

/* Helper macros */
#define w10topa(w) ((paddr_t)W10_U32(w) & MASK22)

/* Minimal NI20 device structure */
struct ni20 {
    struct device ni_dv;        /* Generic device structure */
    int ni_state;               /* Device state */
    uint32 ni_regs[8];          /* Device registers */
    paddr_t ni_pcba;            /* Port Control Block address */
    w10_t ni_ebuf;              /* EBUF word for diagnostics */
    int ni_rar;                 /* RAM Address Register */
    int ni_lar;                 /* Last Address Register */
    uint18 ni_cond;             /* RH CONI bits (CSR) */
    uint18 ni_lhcond;           /* LH CONI bits (CSR) */
    int ni_cmd_pending;         /* Simulate command processing */
    int ni_resp_ready;          /* Simulate response ready */
};

static int nni20s = 0;
static struct ni20 dvni20[NI20_NSUP];

/* Configuration parameters */
#define DVNI20_PARAMS \
    prmdef(NIP_DBG, "debug"),   \
    prmdef(NIP_IP,  "ipaddr")

enum {
# define prmdef(i,s) i
    DVNI20_PARAMS
# undef prmdef
};

static char *niprmtab[] = {
# define prmdef(i,s) s
    DVNI20_PARAMS
# undef prmdef
    , NULL
};

/* Function prototypes */
static int ni20_conf(FILE *f, char *s, struct ni20 *ni);
static int ni20_init(struct device *d, FILE *of);
static void ni20_reset(struct device *d);
static void ni20_powoff(struct device *d);
static uint32 ni20_rdreg(struct device *d, int reg);
static int ni20_wrreg(struct device *d, int reg, dvureg_t val);
static void ni20_cono(struct device *d, h10_t erh);
static w10_t ni20_coni(struct device *d);
static void ni20_datao(struct device *d, w10_t w);
static w10_t ni20_datai(struct device *d);

/* Device creation */
struct device *
dvni20_create(FILE *f, char *s)
{
    register struct ni20 *ni;

    if (0) fprintf(stderr, "*** NI20 STUB CREATE: Entry point called ***\n");
    
    if (nni20s >= NI20_NSUP) {
        fprintf(f, "Too many NI20s, max: %d\n", NI20_NSUP);
        return NULL;
    }
    ni = &dvni20[nni20s++];
    memset((char *)ni, 0, sizeof(*ni));

    /* Initialize device structure */
    iodv_setnull(&ni->ni_dv);
    ni->ni_dv.dv_dflags = DVFL_CTLIO;
    ni->ni_dv.dv_init   = ni20_init;
    ni->ni_dv.dv_reset  = ni20_reset;
    ni->ni_dv.dv_powoff = ni20_powoff;
    ni->ni_dv.dv_rdreg  = ni20_rdreg;
    ni->ni_dv.dv_wrreg  = ni20_wrreg;
    ni->ni_dv.dv_cono   = ni20_cono;
    ni->ni_dv.dv_coni   = ni20_coni;
    ni->ni_dv.dv_datao  = ni20_datao;
    ni->ni_dv.dv_datai  = ni20_datai;

    /* Configure from string */
    if (0) {
        fprintf(stderr, "*** NI20 STUB: DEVICE CREATION CALLED ***\n");
        fprintf(stderr, "*** NI20 STUB: Configuration string: '%s' ***\n", s ? s : "(null)");
        fprintf(stderr, "*** NI20 STUB: PPT constant = 0%o, PID constant = 0%o ***\n", NI20CI_PPT, NI20CI_PID);
    }
    
    if (!ni20_conf(f, s, ni))
        return NULL;

    if (0) fprintf(stderr, "*** NI20 STUB: DEVICE CREATED SUCCESSFULLY ***\n");
    return &ni->ni_dv;
}

/* Configuration parser */
static int
ni20_conf(FILE *f, char *s, struct ni20 *ni)
{
    int i, ret = TRUE;
    struct prmstate_s prm;
    char buff[200];

    DVDEBUG(ni) = FALSE;

    prm_init(&prm, buff, sizeof(buff),
        s, strlen(s),
        niprmtab, sizeof(niprmtab[0]));
    
    while ((i = prm_next(&prm)) != PRMK_DONE) {
        switch (i) {
        case PRMK_NONE:
            fprintf(f, "Unknown NI20 parameter \"%s\"\n", prm.prm_name);
            ret = FALSE;
            continue;
        case PRMK_AMBI:
            fprintf(f, "Ambiguous NI20 parameter \"%s\"\n", prm.prm_name);
            ret = FALSE;
            continue;
        default:
            fprintf(f, "Unsupported NI20 parameter \"%s\"\n", prm.prm_name);
            ret = FALSE;
            continue;

        case NIP_DBG:
            if (!prm.prm_val)
                DVDEBUG(ni) = 1;
            else if (!s_tobool(prm.prm_val, &DVDEBUG(ni)))
                break;
            continue;

        case NIP_IP:
            /* Just ignore IP address - we're a stub */
            if (DVDEBUG(ni))
                fprintf(f, "NI20 stub: ignoring IP address %s\n", prm.prm_val ? prm.prm_val : "");
            continue;
        }
        ret = FALSE;
        fprintf(f, "NI20 param \"%s\": ", prm.prm_name);
        if (prm.prm_val)
            fprintf(f, "bad value syntax: \"%s\"\n", prm.prm_val);
        else
            fprintf(f, "missing value\n");
    }

    return ret;
}

/* Device initialization */
static int
ni20_init(struct device *d, FILE *of)
{
    register struct ni20 *ni = (struct ni20 *)d;
    
    if (0) {
        fprintf(stderr, "*** NI20 STUB: DEVICE INITIALIZATION CALLED ***\n");
        fprintf(stderr, "*** NI20 STUB: This device is being initialized ***\n");
    }
    fprintf(of, "NI20 stub: initialized (no actual networking)\n");
    
    ni->ni_state = 1; /* Mark as "ready" */
    ni->ni_pcba = 0;  /* No PCB initially */
    ni->ni_cmd_pending = 0;  /* No commands pending */
    ni->ni_resp_ready = 0;   /* No responses ready */
    
    /* Set proper initial status - hardcode values to ensure they're correct */
    /* PPT=0400000, IDL=0100, ECP=020, PID=07 */
    ni->ni_lhcond = 0400000 | 0100 | 020 | 07;  /* Port present + Idle + Enable complete + Port ID 7 */
    ni->ni_cond = 020;  /* ENA - Enable */
    
    if (0) fprintf(stderr, "*** NI20 STUB INIT: Set lhcond=0%o, cond=0%o ***\n", ni->ni_lhcond, ni->ni_cond);
    
    fprintf(of, "NI20 stub: PCB=0x%lx, cond=0%o, lhcond=0%o\n", 
            (long)ni->ni_pcba, ni->ni_cond, ni->ni_lhcond);
    return TRUE;
}

/* Device reset */
static void
ni20_reset(struct device *d)
{
    register struct ni20 *ni = (struct ni20 *)d;
    
    memset(ni->ni_regs, 0, sizeof(ni->ni_regs));
    ni->ni_state = 1; /* Keep "ready" */
    ni->ni_pcba = 0;  /* Clear PCB */
    ni->ni_cmd_pending = 0;  /* Clear commands */
    ni->ni_resp_ready = 0;   /* Clear responses */
    /* Hardcode correct values */
    ni->ni_lhcond = 0400000 | 0100 | 020 | 07;  /* PPT + IDL + ECP + PID=7 */
    ni->ni_cond = 020;  /* ENA */
}

/* Power off */
static void
ni20_powoff(struct device *d)
{
    register struct ni20 *ni = (struct ni20 *)d;
    ni->ni_state = 0;
}

/* Read register */
static uint32
ni20_rdreg(struct device *d, int reg)
{
    register struct ni20 *ni = (struct ni20 *)d;
    
    if (reg >= 0 && reg < 8) {
        if (reg == 0) {
            /* Status register - always show as ready */
            return 0x8000; /* Ready bit */
        }
        return ni->ni_regs[reg];
    }
    return 0;
}

/* Write register */
static int
ni20_wrreg(struct device *d, int reg, dvureg_t val)
{
    register struct ni20 *ni = (struct ni20 *)d;
    
    if (reg >= 0 && reg < 8) {
        ni->ni_regs[reg] = val;
        
        if (DVDEBUG(ni))
            fprintf(DVDBF(ni), "NI20 stub: reg[%d] = %o (ignored)\n", reg, (unsigned)val);
        
        return TRUE;
    }
    return FALSE;
}

/* CONO instruction handler */
static void
ni20_cono(struct device *d, h10_t erh)
{
    register struct ni20 *ni = (struct ni20 *)d;
    
    /* Debug output disabled to prevent buffer overflow */
    
    /* Handle control bits that require specific actions */
    if (erh & 0400000) {  /* CPT - Clear port */
        /* Clear port - reset everything */
        ni->ni_cond = 020;  /* ENA */
        ni->ni_lhcond = 0400000 | 0100 | 020 | 07;  /* PPT + IDL + ECP + PID=7 */
        ni->ni_pcba = 0;
        memset(ni->ni_regs, 0, sizeof(ni->ni_regs));
        /* Port clear debug disabled */
        return;
    }
    
    /* Update basic control bits */
    ni->ni_cond = (ni->ni_cond & ~0177777) | (erh & 0177777);
    
    /* Handle enable/disable */
    if (erh & NI20CO_ENA) {
        ni->ni_lhcond |= NI20CI_ECP;  /* Set Enable Complete */
        /* Port enable debug disabled */
    }
    if (erh & NI20CO_DIS) {
        ni->ni_lhcond |= NI20CI_DCP;  /* Set Disable Complete */
        ni->ni_lhcond &= ~NI20CI_ECP; /* Clear Enable Complete */
        /* Port disable debug disabled */
    }
    
    /* Clear specific error/status bits that are cleared by CONO */
    if (erh & NI20CI_RQA) {
        ni->ni_cond &= ~NI20CI_RQA;  /* Clear Response Queue Available */
        /* RQA clear debug disabled */
    }
    if (erh & NI20CI_FQE) {
        ni->ni_cond &= ~NI20CI_FQE;  /* Clear Free Queue Error */
        /* FQE clear debug disabled */
    }
    if (erh & NI20CI_DME) {
        ni->ni_cond &= ~NI20CI_DME;  /* Clear Data Mover Error */
        /* DME clear debug disabled */
    }
    
    /* Handle microprocessor run bit - this is critical for initialization! */
    if (erh & NI20CO_MRN) {
        fprintf(stderr, "🔧 NI20: Microprocessor START (RAR=%o)\n", ni->ni_rar);
        /* Transition to running state like real NI20 */
        ni->ni_state = 2;  /* NI20_ST_RUN - Running disabled */
        ni->ni_lhcond |= NI20CI_IDL;  /* Set Idle - microprocessor is running */
        
        /* Simulate microcode execution startup - when started at address 0,
         * the real NI20 microcode does a channel transfer to get PCB info */
        if (ni->ni_rar == 0) {
            fprintf(stderr, "🎯 NI20: Starting microcode at address 0\n");
            /* The microcode should perform a 3-word channel transfer here.
             * For our stub, we'll just ensure the device appears properly initialized. */
        }
        
        /* Handle disable/enable during startup */
        if (erh & NI20CO_DIS) {
            /* TOPS-20 sets MRN+DIS during initialization */
            ni->ni_lhcond |= NI20CI_DCP;  /* Set Disable Complete */
            fprintf(stderr, "✅ NI20: DCP - Disable Complete\n");
        }
    } else {
        /* Stop requested */
        fprintf(stderr, "⏹️ NI20: Microprocessor STOP\n");
        ni->ni_state = 1;  /* NI20_ST_HALT - Halted */
        ni->ni_lhcond &= ~NI20CI_IDL;  /* Clear Idle */
    }
    
    /* Handle enable bit - TOPS-20 sets this after seeing DCP */
    if (erh & NI20CO_ENA) {
        if (ni->ni_state >= 2) {  /* If running (disabled or enabled) */
            ni->ni_state = 3;  /* NI20_ST_RUNENA - Running enabled */
            ni->ni_lhcond |= NI20CI_ECP;  /* Set Enable Complete */
            
            /* When enabled, the real NI20 microcode performs initialization:
             * - Reads PCB (Port Control Block) 
             * - Sets up internal queues and data structures
             * - Becomes ready to process commands
             * We simulate this by ensuring all the right status bits are set.
             */
            ni->ni_cond |= NI20CO_CQA;  /* Set Command Queue Available */
            
            fprintf(stderr, "✅ NI20: ECP - Enable Complete + CQA Ready\n");
        } else {
            /* Not running yet, just set ECP */
            ni->ni_lhcond |= NI20CI_ECP;
            fprintf(stderr, "✅ NI20: ECP - Enable Complete (not running)\n");
        }
    }
}

/* CONI instruction handler */
static w10_t
ni20_coni(struct device *d)
{
    register struct ni20 *ni = (struct ni20 *)d;
    w10_t w;
    
    /* Force consistent status values for stub */
    ni->ni_lhcond |= (0400000 | 0100 | 020 | 07);  /* Ensure PPT + IDL + ECP + PID=7 */
    ni->ni_cond |= 020;  /* Ensure ENA */
    
    /* Return current status from cached values */
    LRHSET(w, ni->ni_lhcond, ni->ni_cond);
    
    /* CONI debug output disabled */
    
    return w;
}

/* DATAO instruction handler */
static void
ni20_datao(struct device *d, w10_t w)
{
    register struct ni20 *ni = (struct ni20 *)d;
    
    /* DATAO debug output disabled */
    
    if (ni->ni_cond & NI20CO_SEB) {
        /* Writing to EBUF */
        ni->ni_ebuf = w;
        return;
    }
    
    if (LHGET(w) & NI20DO_LRA) {
        /* Load RAM Address Register */
        ni->ni_rar = (LHGET(w) & (NI20DO_RAR | NI20DO_MSB)) >> 4;
        /* RAR debug output disabled */
    } else {
        /* Writing microcode RAM or queue operations */
        paddr_t addr = w10topa(w) & MASK22;
        
        /* Store PCB address on first write */
        if (ni->ni_pcba == 0) {
            ni->ni_pcba = addr;
            /* PCB debug output disabled */
            
            /* Simulate successful PCB initialization */
            /* Set Command Queue Available to indicate we can accept commands */
            ni->ni_cond |= NI20CO_CQA;
            /* CQA debug output disabled */
        } else {
            /* Could be microcode load or queue operations */
            /* DATAO operation debug output disabled */
            
            /* Simulate successful operation completion */
            /* For microcode reload, TOPS-20 expects the device to become ready */
            /* Set appropriate status bits to indicate successful operation */
            ni->ni_lhcond |= NI20CI_IDL;  /* Device is idle (ready) */
            ni->ni_lhcond |= NI20CI_ECP;  /* Enable complete */
            
            /* Operation complete debug output disabled */
        }
    }
}

/* DATAI instruction handler */
static w10_t
ni20_datai(struct device *d)
{
    register struct ni20 *ni = (struct ni20 *)d;
    w10_t w;
    
    if (ni->ni_cond & NI20CO_SEB) {
        /* Reading EBUF word */
        w = ni->ni_ebuf;
    } else if (ni->ni_cond & NI20CO_LAR) {
        /* Reading Last Address Register */
        LRHSET(w, (0400000 | (ni->ni_lar << 5) | 07), H10MASK);
    } else if (ni->ni_resp_ready && (ni->ni_cond & NI20CI_RQA)) {
        /* Return simulated response data when response is available */
        /* Simulate a successful command completion response */
        LRHSET(w, 0, 0);  /* Success status */
        
        /* Clear response ready and RQA after reading response */
        ni->ni_resp_ready = 0;
        ni->ni_cmd_pending = 0;
        /* Note: RQA will be cleared by CONO, not here */
        
        /* Response debug disabled */
    } else {
        /* Reading microcode RAM - return version info for known addresses */
        switch (ni->ni_rar) {
        case (0136<<1)+1:  /* NI20_UA_VER address 189 - RAR 274 octal */
            /* Version register - return proper major/minor version */
            LRHSET(w, 0, (01<<12) | (0<<6));  /* Major=1, Minor=0 */
            /* Version info debug output disabled */
            break;
        case (0137<<1)+1:  /* NI20_UA_EDT address 191 - RAR 277 octal */
            /* Edit number register - return edit number */
            LRHSET(w, 0, (0172<<6));  /* Edit number 172 octal in proper format */
            /* Edit number debug output disabled */
            break;
        default:
            /* For reload simulation, return success patterns for other addresses */
            if (ni->ni_rar >= 0 && ni->ni_rar < 512) {
                /* Simulate microcode memory with pattern that indicates successful load */
                LRHSET(w, 0, 0);  /* Most locations zero is fine */
            } else {
                LRHSET(w, 0, 0);
            }
            break;
        }
    }
    
    /* DATAI debug output disabled */
    
    return w;
}

#endif /* KLH10_DEV_NI20 */