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

    fprintf(stderr, "*** NI20 STUB CREATE: Entry point called ***\n");
    
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
    fprintf(stderr, "*** NI20 STUB: DEVICE CREATION CALLED ***\n");
    fprintf(stderr, "*** NI20 STUB: Configuration string: '%s' ***\n", s ? s : "(null)");
    fprintf(stderr, "*** NI20 STUB: PPT constant = 0%o, PID constant = 0%o ***\n", NI20CI_PPT, NI20CI_PID);
    
    if (!ni20_conf(f, s, ni))
        return NULL;

    fprintf(stderr, "*** NI20 STUB: DEVICE CREATED SUCCESSFULLY ***\n");
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
    
    fprintf(stderr, "*** NI20 STUB: DEVICE INITIALIZATION CALLED ***\n");
    fprintf(stderr, "*** NI20 STUB: This device is being initialized ***\n");
    fprintf(of, "NI20 stub: initialized (no actual networking)\n");
    
    ni->ni_state = 1; /* Mark as "ready" */
    ni->ni_pcba = 0;  /* No PCB initially */
    ni->ni_cmd_pending = 0;  /* No commands pending */
    ni->ni_resp_ready = 0;   /* No responses ready */
    
    /* Set proper initial status - hardcode values to ensure they're correct */
    /* PPT=0400000, IDL=0100, ECP=020, PID=07 */
    ni->ni_lhcond = 0400000 | 0100 | 020 | 07;  /* Port present + Idle + Enable complete + Port ID 7 */
    ni->ni_cond = 020;  /* ENA - Enable */
    
    fprintf(stderr, "*** NI20 STUB INIT: Set lhcond=0%o, cond=0%o ***\n", ni->ni_lhcond, ni->ni_cond);
    
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
    
    fprintf(stderr, "NI20 stub: CONO %o (was cond=%o)\n", (unsigned)erh, ni->ni_cond);
    
    /* Handle control bits that require specific actions */
    if (erh & 0400000) {  /* CPT - Clear port */
        /* Clear port - reset everything */
        ni->ni_cond = 020;  /* ENA */
        ni->ni_lhcond = 0400000 | 0100 | 020 | 07;  /* PPT + IDL + ECP + PID=7 */
        ni->ni_pcba = 0;
        memset(ni->ni_regs, 0, sizeof(ni->ni_regs));
        fprintf(stderr, "NI20 stub: Port cleared\n");
        return;
    }
    
    /* Update basic control bits */
    ni->ni_cond = (ni->ni_cond & ~0177777) | (erh & 0177777);
    
    /* Handle enable/disable */
    if (erh & NI20CO_ENA) {
        ni->ni_lhcond |= NI20CI_ECP;  /* Set Enable Complete */
        fprintf(stderr, "NI20 stub: Port enabled\n");
    }
    if (erh & NI20CO_DIS) {
        ni->ni_lhcond |= NI20CI_DCP;  /* Set Disable Complete */
        ni->ni_lhcond &= ~NI20CI_ECP; /* Clear Enable Complete */
        fprintf(stderr, "NI20 stub: Port disabled\n");
    }
    
    /* Clear specific error/status bits that are cleared by CONO */
    if (erh & NI20CI_RQA) {
        ni->ni_cond &= ~NI20CI_RQA;  /* Clear Response Queue Available */
        fprintf(stderr, "NI20 stub: Cleared RQA\n");
    }
    if (erh & NI20CI_FQE) {
        ni->ni_cond &= ~NI20CI_FQE;  /* Clear Free Queue Error */
        fprintf(stderr, "NI20 stub: Cleared FQE\n");
    }
    if (erh & NI20CI_DME) {
        ni->ni_cond &= ~NI20CI_DME;  /* Clear Data Mover Error */
        fprintf(stderr, "NI20 stub: Cleared DME\n");
    }
    
    /* Handle microprocessor run bit */
    if (erh & NI20CO_MRN) {
        fprintf(stderr, "NI20 stub: Microprocessor run requested\n");
        /* For stub, just indicate we're running and idle */
        ni->ni_lhcond |= NI20CI_IDL;
    }
}

/* CONI instruction handler */
static w10_t
ni20_coni(struct device *d)
{
    register struct ni20 *ni = (struct ni20 *)d;
    w10_t w;
    
    /* Debug: Force correct values and see if they stick */
    static int debug_count = 0;
    if (debug_count < 3) {
        fprintf(stderr, "*** NI20 STUB CONI DEBUG %d ***\n", debug_count);
        fprintf(stderr, "Before: lhcond=0%o, cond=0%o\n", ni->ni_lhcond, ni->ni_cond);
        
        /* Force the values we want */
        ni->ni_lhcond = 0400000 | 0100 | 020 | 07;  /* PPT + IDL + ECP + PID=7 */
        ni->ni_cond = 020;  /* ENA */
        
        fprintf(stderr, "After: lhcond=0%o, cond=0%o\n", ni->ni_lhcond, ni->ni_cond);
        debug_count++;
    }
    
    /* Return current status from cached values */
    LRHSET(w, ni->ni_lhcond, ni->ni_cond);
    
    fprintf(stderr, "NI20 stub: CONI -> %o,,%o (lhcond=%o, cond=%o)\n", 
            LHGET(w), RHGET(w), ni->ni_lhcond, ni->ni_cond);
    
    return w;
}

/* DATAO instruction handler */
static void
ni20_datao(struct device *d, w10_t w)
{
    register struct ni20 *ni = (struct ni20 *)d;
    
    fprintf(stderr, "NI20 stub: DATAO %o,,%o (SEB=%d, LRA=%d)\n", 
            LHGET(w), RHGET(w), 
            (ni->ni_cond & NI20CO_SEB) ? 1 : 0,
            (LHGET(w) & NI20DO_LRA) ? 1 : 0);
    
    if (ni->ni_cond & NI20CO_SEB) {
        /* Writing to EBUF */
        ni->ni_ebuf = w;
        return;
    }
    
    if (LHGET(w) & NI20DO_LRA) {
        /* Load RAM Address Register */
        ni->ni_rar = (LHGET(w) & (NI20DO_RAR | NI20DO_MSB)) >> 4;
        fprintf(stderr, "NI20 stub: RAR = %o\n", ni->ni_rar);
    } else {
        /* Writing microcode RAM or queue operations */
        paddr_t addr = w10topa(w) & MASK22;
        
        /* Store PCB address on first write */
        if (ni->ni_pcba == 0) {
            ni->ni_pcba = addr;
            fprintf(stderr, "NI20 stub: PCB base = %lo\n", (long)ni->ni_pcba);
            
            /* Simulate successful PCB initialization */
            /* Set Command Queue Available to indicate we can accept commands */
            ni->ni_cond |= NI20CO_CQA;
            fprintf(stderr, "NI20 stub: Set CQA - ready for commands\n");
        } else {
            /* Subsequent writes might be queue entries - simulate command processing */
            fprintf(stderr, "NI20 stub: Queue operation addr=%lo (simulating command)\n", (long)addr);
            
            /* Simulate command processing: */
            /* 1. Mark command as being processed */
            ni->ni_cmd_pending = 1;
            
            /* 2. Immediately simulate successful completion */
            /* Set Response Queue Available to indicate command completed */
            ni->ni_cond |= NI20CI_RQA;
            ni->ni_resp_ready = 1;
            
            fprintf(stderr, "NI20 stub: Set RQA - response ready\n");
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
        
        fprintf(stderr, "NI20 stub: Returned response data (success)\n");
    } else {
        /* Reading microcode RAM - return version info for known addresses */
        switch (ni->ni_rar) {
        case (NI20_UA_VER<<1)+1:
            /* Version register */
            LRHSET(w, 0, ((NI20_VERMAJ)<<12) | ((NI20_VERMIN<<6)));
            break;
        case (NI20_UA_EDT<<1)+1:
            /* Edit number register */
            LRHSET(w, 0, (NI20_EDITNO<<6));
            break;
        default:
            /* Default to zero */
            LRHSET(w, 0, 0);
            break;
        }
    }
    
    fprintf(stderr, "NI20 stub: DATAI -> %o,,%o (SEB=%d, LAR=%d, RAR=%o)\n", 
            LHGET(w), RHGET(w),
            (ni->ni_cond & NI20CO_SEB) ? 1 : 0,
            (ni->ni_cond & NI20CO_LAR) ? 1 : 0,
            ni->ni_rar);
    
    return w;
}

#endif /* KLH10_DEV_NI20 */